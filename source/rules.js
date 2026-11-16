// 브라우저와 서버가 같은 입력 검증과 채점 규칙을 쓴다.
globalThis.GEEZ = (() => {
  const subjects = ["과학", "지리", "역사", "문화", "생활"];
  const difficulty = art => ["하", "중", "상"][Math.floor(art / 3)];
  const xpFor = art => [20, 35, 50][Math.floor(art / 3)];

  // 전각 문자, 대소문자, 연속 공백, 천 단위 쉼표를 정리한 뒤 정답을 비교한다.
  const norm = value => String(value)
    .normalize("NFKC")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/(\d),(?=\d{3}\b)/g, "$1");
  const grade = (monster, answer) =>
      monster.answers.some(value => norm(value) === norm(answer));

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
    
    // 단답형은 같은 답의 여러 표기를 허용한다. 보기와 태그는 중복을 검사한다.
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
      throw Error("GEEZ 퀴즈 파일을 선택해 주세요.");
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
      // 같은 문제를 다시 풀어도 첫 도전 정답률의 분모와 분자는 그대로다.
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
      // 첫 시도에 틀려도 나중에 처음 맞히면 포획과 경험치를 한 번 지급한다.
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
  const monsters = GEEZ_QUESTIONS.map(monster);
  const single = m =>
      fromItems("monster", m.name, m.tags.find(t => t !== "일반상식") || m.tags[0], [m]);
  const catalog =
      monsters.map((m, i) => ({id: "g" + (i + 1), author: "Master", pack: single(m)}));
  for (const [i, tag] of subjects.entries()) {
    catalog.push({
      id: "d" + (i + 1),
      author: "Master",
      pack: fromItems(
          "dungeon", tag + " 던전", tag, monsters.filter(m => m.tags.includes(tag)).slice(0, 5))
    });
  }
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
    catalog
  };
})();
