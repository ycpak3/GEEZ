// 브라우저와 서버가 공유하는 입력 검증 및 채점 규칙
globalThis.GEEZ = (() => {
  const subjects = ["과학", "지리", "역사", "문화", "생활"];
  const difficulty = art => ["하", "중", "상"][Math.floor(art / 3)];
  const xpFor = art => [20, 35, 50][Math.floor(art / 3)];

  // 전각 문자·대소문자·공백·천 단위 쉼표를 정규화해 정답 비교
  const norm = value => String(value)
                            .normalize("NFKC")
                            .trim()
                            .toLowerCase()
                            .replace(/\s+/g, " ")
                            .replace(/(\d),(?=\d{3}\b)/g, "$1");
  const grade = (monster, answer) => monster.answers.some(value => norm(value) === norm(answer));

  function matchesFilters(pack, kind, tag) {
    return (!kind || pack.kind === kind) && (!tag || pack.items.some(item => item.tags.includes(tag)));
  }

  function matchesQuery(pack, query) {
    const fields = [pack.name, pack.tag, ...pack.items.flatMap(item => [item.question, ...item.tags])];
    return fields.some(value => value.toLowerCase().includes(query.toLowerCase()));
  }

  function word(value, max, label) {
    if (typeof value !== "string" || !value.trim() || value.trim().length > max) {
      throw Error(label + " 항목을 확인해 주세요.");
    }
    return value.trim();
  }

  function words(values, min, max, length, label) {
    if (!Array.isArray(values) || values.length < min || values.length > max) {
      throw Error(label + " 개수를 확인해 주세요.");
    }
    const list = values.map(value => word(value, length, label));

    // 단답형의 복수 표기를 허용하고 보기와 태그의 중복 검사
    if (label !== "정답" && new Set(list.map(norm)).size !== list.length) {
      throw Error(label + "에 중복 값이 있어요.");
    }
    return list;
  }

  function monster(raw) {
    if (!raw || !Number.isInteger(raw.art) || raw.art < 0 || raw.art > 8) {
      throw Error("몬스터 외형을 골라 주세요.");
    }
    const name = word(raw.name, 36, "몬스터 이름");
    const tags = words(raw.tags, 1, 5, 16, "태그");
    const question = word(raw.question, 600, "문제");
    const choices = words(raw.choices, 0, 4, 100, "보기");
    const answers = words(raw.answers, 1, 8, 100, "정답");
    if (choices.length === 1 ||
        (choices.length && (answers.length !== 1 || !choices.includes(answers[0])))) {
      throw Error("선택형은 서로 다른 보기 2~4개와 그중 하나의 정답이 필요해요.");
    }
    if (typeof raw.explain !== "string" || raw.explain.length > 500) {
      throw Error("해설은 500자까지 입력할 수 있어요.");
    }
    if (![0, 15, 30, 60, 120].includes(raw.seconds)) {
      throw Error("제한 시간을 확인해 주세요.");
    }
    return {
      name,
      tags,
      art: raw.art,
      question,
      choices,
      answers,
      explain: raw.explain.trim(),
      seconds: raw.seconds
    };
  }

  function pack(raw) {
    if (raw?.format !== "geez-quiz-1" || !["monster", "dungeon"].includes(raw.kind)) {
      throw Error("GEEZ 작품 형식을 확인해 주세요.");
    }
    const name = word(raw.name, 48, "이름");
    if (!Array.isArray(raw.items) || !raw.items.length || raw.items.length > 20 ||
        (raw.kind === "monster" && raw.items.length !== 1)) {
      throw Error("무리 크기는 1~20마리예요.");
    }
    const items = raw.items.map(monster);
    const tag = word(raw.tag, 16, "공통 태그");
    if (!items.every(item => item.tags.includes(tag))) {
      throw Error("모든 몬스터에 공통 태그가 필요해요.");
    }
    if (new Set(items.map(item => JSON.stringify(item))).size !== items.length) {
      throw Error("같은 몬스터가 중복됐어요.");
    }
    return {format: raw.format, kind: raw.kind, name, tag, items};
  }

  function fromItems(kind, name, tag, items) {
    return pack({format: "geez-quiz-1", kind, name, tag, items});
  }

  function summarize(attempts) {
    const records = new Map();
    const tags = new Map();
    let xp = 0;
    let caught = 0;
    let first = 0;
    for (const {item, correct} of attempts) {
      const key = JSON.stringify(item);
      // 재도전 결과와 무관하게 문항별 첫 제출의 정오 보존
      if (!records.has(key)) {
        records.set(key, {item, first: correct, caught: false, tries: 0});
        if (correct) {
          first++;
        }
        for (const tag of item.tags) {
          const stat = tags.get(tag) || {total: 0, right: 0, caught: 0};
          stat.total++;
          if (correct) {
            stat.right++;
          }
          tags.set(tag, stat);
        }
      }
      const row = records.get(key);
      row.tries++;
      // 처음 정답을 제출한 시점에 포획과 경험치 한 번 지급
      if (correct && !row.caught) {
        row.caught = true;
        caught++;
        xp += xpFor(item.art);
        for (const tag of item.tags) {
          tags.get(tag).caught++;
        }
      }
    }
    return {records: [...records.values()], tags, xp, caught, first, total: records.size};
  }
  // 오답 당시의 문항을 복원하고 공개 원본이 있으면 회원 채점에 연결
  function reviewDungeon(summary, entries) {
    const eligible = [...summary.tags].filter(([, stat]) => stat.total >= 3 && stat.right < stat.total);
    const specific = eligible.filter(([tag]) => tag !== "일반상식");
    const ranked = specific.length ? specific : eligible;
    ranked.sort(
        ([left, a], [right, b]) => a.right / a.total - b.right / b.total || b.total - a.total ||
            left.localeCompare(right, "ko"));
    if (!ranked.length) return null;

    const [tag] = ranked[0];
    const sources = new Map();
    for (const entry of entries) {
      entry.pack.items.forEach((item, index) => {
        if (!item.tags.includes(tag)) return;
        const key = JSON.stringify(item);
        if (!sources.has(key) || (sources.get(key).local && !entry.local)) {
          sources.set(key, {item, id: entry.id, index, local: Boolean(entry.local)});
        }
      });
    }
    const seen = new Set(summary.records.map(row => JSON.stringify(row.item)));
    const missed = summary.records.filter(row => !row.first && row.item.tags.includes(tag))
                       .sort((a, b) => Number(a.caught) - Number(b.caught));
    const rounds = missed.slice(0, 5).map(
        ({item}) =>
            ({...(sources.get(JSON.stringify(item)) || {item, local: true}), previousMiss: true}));
    for (const [key, source] of sources) {
      if (rounds.length >= 5) break;
      if (!seen.has(key)) rounds.push({...source, previousMiss: false});
    }
    return {rounds, pack: fromItems("dungeon", tag + " 복습 던전", tag, rounds.map(row => row.item))};
  }

  const single = m => fromItems("monster", m.name, m.tags.find(t => t !== "일반상식") || m.tags[0], [m]);
  return {
    subjects,
    difficulty,
    xpFor,
    grade,
    monster,
    pack,
    fromItems,
    single,
    summarize,
    reviewDungeon,
    matchesFilters,
    matchesQuery
  };
})();
