"use strict";

function keepDraft(raw) {
  // 직접 만든 작품과 링크로 받은 작품의 형식을 검사해 보관
  const pack = GEEZ.pack(raw);
  const id = "local-" + uid();
  saveLocal(
      "draft", id,
      {id, pack, author: model.user?.nickname || "내 보관함", created: Date.now(), local: true});
  return id;
}

function studio(initialQuery = "") {
  const local = drafts();
  const localIds = new Set(local.map(entry => entry.id));
  const saved = [...local, ...model.shared.filter(entry => entry.ownDraftId && !localIds.has(entry.ownDraftId))];
  main.innerHTML = `
    <h1>내 보관함</h1>
    <p>만든 문제와 던전은 먼저 이 브라우저에 저장돼요.</p>
    <div class="actions">
      <button id="new-monster">몬스터 만들기</button>
      <button id="new-dungeon">던전 만들기</button>
    </div>
    <label>보관함 검색<input type="search" id="draft-search" placeholder="이름, 질문, 태그로 검색"></label>
    <section><h2>내 몬스터</h2><div id="my-monsters"></div></section>
    <section><h2>내 던전</h2><div id="my-dungeons"></div></section>`;
  const search = $("#draft-search");
  search.value = initialQuery;
  function showSaved() {
    const query = search.value.trim();
    for (const [kind, target] of [["monster", $("#my-monsters")], ["dungeon", $("#my-dungeons")]]) {
      const matches = saved.filter(e => e.pack.kind === kind && GEEZ.matchesQuery(e.pack, query));
      target.innerHTML = matches.length ? '<div class="grid">' + matches.map(entry => `
        <div class="saved-card">${card(entry)}
          <button type="button" class="quiet danger" data-remove="${esc(entry.id)}"
            aria-label="${esc(entry.pack.name)} 삭제">삭제</button>
        </div>`).join("") + '</div>' :
        '<p class="muted">' + (query ? "검색 결과가 없어요." : "아직 저장한 항목이 없어요.") + '</p>';
      target.onclick = handle(event => {
        const button = event.target.closest("[data-remove]");
        if (button) confirmPackRemoval(saved.find(entry => entry.id === button.dataset.remove), query);
      });
    }
  }
  search.oninput = showSaved;
  showSaved();
  $("#new-monster").onclick = monsterForm;
  $("#new-dungeon").onclick = dungeonForm;
}

function confirmPackRemoval(entry, query = "") {
  const draftId = entry.local ? entry.id : entry.ownDraftId;
  if (!draftId || entry.received) return;
  const accountId = model.user?.id;
  const storageKey = localPrefix("draft") + draftId;
  popup("작품 삭제", `<p>‘${esc(entry.pack.name)}’을 삭제할까요?
    공용 목록에 등록한 작품이면 공개 링크도 종료돼요. 이미 저장된 사본과 풀이 기록은 유지돼요.</p>
    <div class="actions"><button id="cancel-remove" class="quiet">취소</button>
    <button id="confirm-remove" class="danger">삭제하기</button></div>`);
  $("#cancel-remove").onclick = () => dialog.close();
  const remove = $("#confirm-remove");
  remove.onclick = handle(async () => {
    remove.disabled = true;
    try {
      if (accountId) await api("delete-pack", {accountId, draftId});
      localStorage.removeItem(storageKey);
      model.shared = model.shared.filter(e => e.ownDraftId !== draftId);
      dialog.close();
      if (location.hash === "#studio") studio(query);
      else location.hash = "studio";
      notify("작품을 삭제했어요.");
    } finally {
      remove.disabled = false;
    }
  });
}

function monsterForm() {
  const looks = [
    "새싹 슬라임", "달걀 삐약이", "딸기 버섯콩", "잎새 여우", "수정 골렘", "별모자 유령", "잿불 드래곤",
    "밤왕관 박쥐", "호박석 거북"
  ];
  const artOptions =
      looks.map((name, index) => `<option value="${index}">${name} · ${GEEZ.difficulty(index)}</option>`)
          .join("");
  const timeOptions =
      [0, 15, 30, 60, 120]
          .map(seconds => `<option value="${seconds}">${seconds ? seconds + "초" : "없음"}</option>`)
          .join("");

  popup(
      "몬스터 만들기",
      `
    <form id="make">
      <label>몬스터 이름<input name="name" maxlength="36" required></label>
      <img id="sample" class="question-art" src="art/m0.webp" alt="선택한 몬스터 외형">
      <div class="filters">
        <label>외형·난이도<select name="art">${artOptions}</select></label>
        <label>제한 시간<select name="seconds">${timeOptions}</select></label>
      </div>
      <label>태그<input name="tags" placeholder="과학, 생물 (최대 5개)" required></label>
      <label>질문<textarea name="question" maxlength="600" required></textarea></label>
      ${
          model.online ? `<div>
        <button type="button" class="quiet" id="similar" disabled>비슷한 공개 문항 확인</button>
        <div id="matches" aria-live="polite"></div>
      </div>` :
                         ""}
      <label>문제 유형
        <select name="kind"><option>선택형</option><option>단답형</option></select>
      </label>
      <label id="choice-field">
        보기 (한 줄에 하나씩, 2~4개)<textarea name="choices" required></textarea>
      </label>
      <label>정답<input name="answers" required></label>
      <small id="answer-hint">보기 중 하나를 그대로 적어 주세요.</small>
      <label>해설<textarea name="explain" maxlength="500"></textarea></label>
      <button>내 몬스터에 저장</button>
    </form>`);
  const form = $("#make");
  const similar = $("#similar");
  if (similar) {
    const field = form.elements.question;
    const output = $("#matches");
    let revision = 0;
    field.oninput = () => {
      revision++;
      similar.disabled = field.value.trim().length < 3;
      output.textContent = "";
    };
    similar.onclick = async () => {
      const current = ++revision;
      similar.disabled = true;
      output.textContent = "공개 문항을 검색하고 있어요.";
      try {
        const {matches} = await api("similar", {question: field.value.trim()});
        if (current !== revision) return;
        output.innerHTML = matches.length ? '<ul class="compact">' +
                matches
                    .map(
                        match =>
                            `<li>${esc(match.question)} · 유사도 ${Math.round(match.score * 100)}%</li>`)
                    .join("") +
                '</ul>' :
                                            "표현이 비슷한 공개 문항이 없어요.";
      } catch (err) {
        if (current === revision) output.textContent = err.message;
      } finally {
        if (current === revision) similar.disabled = false;
      }
    };
  }
  form.elements.art.onchange = () => $("#sample").src = "art/m" + form.elements.art.value + ".webp";
  form.elements.kind.onchange = () => {
    const choice = form.elements.kind.value === "선택형";
    $("#choice-field").style.display = choice ? "grid" : "none";
    form.elements.choices.required = choice;
    $("#answer-hint").textContent =
        choice ? "보기 중 하나를 그대로 적어 주세요." : "여러 정답은 | 기호로 구분해 주세요.";
  };
  form.onsubmit = handle(() => {
    const fields = Object.fromEntries(new FormData(form));
    const choice = fields.kind === "선택형";
    const item = GEEZ.monster({
      ...fields,
      art: Number(fields.art),
      seconds: Number(fields.seconds),
      tags: fields.tags.split(",").map(t => t.trim()).filter(Boolean),
      choices: choice ? fields.choices.split(/\r?\n/).map(t => t.trim()).filter(Boolean) : [],
      answers: choice ? [fields.answers] : fields.answers.split("|")
    });
    keepDraft(GEEZ.single(item));
    dialog.close();
    studio();
    notify("몬스터를 저장했어요.");
  });
}

function dungeonForm() {
  // 여러 던전에 등장하는 같은 문항의 중복 제거
  const unique = new Map();
  for (const {pack} of entries()) {
    for (const m of pack.items) {
      unique.set(JSON.stringify(m), m);
    }
  }
  const all = [...unique.values()];
  const tags = [...new Set(all.flatMap(m => m.tags))].sort((a, b) => a.localeCompare(b, "ko"));
  const tagOptions = tags.map(tag => `<option>${esc(tag)}</option>`).join("");
  popup("던전 만들기", `
    <form id="build">
      <label>던전 이름<input name="name" maxlength="48" required></label>
      <label>공통 태그<select name="tag">${tagOptions}</select></label>
      <label>무리 크기 <output id="size"></output>
        <input aria-label="무리 크기" type="range" name="count" min="1" max="20" value="1">
      </label>
      <label>등장 순서</label>
      <ol class="compact" id="order"></ol>
      <label>몬스터 검색<input type="search" name="query" placeholder="이름, 질문, 태그로 검색"></label>
      <small id="pool-count" role="status"></small>
      <div class="picklist stack" id="pool"></div>
      <button type="button" id="more-monsters" class="quiet" hidden>더 보기</button>
      <button id="save-dungeon">내 던전에 저장</button>
    </form>`);
  const form = $("#build");
  // 선택 배열 순서대로 던전의 등장 순서 유지
  let selected = [];
  let limit = 24;
  function list() {
    const count = Number(form.elements.count.value);
    $("#size").textContent = count + "마리 · 선택 " + selected.length + "/" + count;
    $("#order").innerHTML = selected.map(i => '<li>' + esc(all[i].name) + '</li>').join("");
    const query = form.elements.query.value.trim().toLowerCase();
    const matches = all.map((monster, index) => ({monster, index})).filter(({monster}) =>
      monster.tags.includes(form.elements.tag.value) &&
      [monster.name, monster.question, ...monster.tags].some(text => text.toLowerCase().includes(query)));
    $("#pool-count").textContent = matches.length ? `검색 결과 ${matches.length}마리 중 ${Math.min(limit, matches.length)}마리 표시` : "검색 결과가 없어요.";
    $("#more-monsters").hidden = matches.length <= limit;
    $("#pool").innerHTML = matches.slice(0, limit).map(({monster, index}) => {
                                const checked = selected.includes(index);
                                const disabled = !checked && selected.length >= count;
                                return `
        <label class="choice">
          <input type="checkbox" value="${index}" ${checked ? "checked" : ""} ${
                                    disabled ? "disabled" : ""}>
          <span>${esc(monster.name)}<small class="pool-question">${esc(monster.question)}</small></span>
        </label>`;
                              })
                               .join("");
    $("#save-dungeon").disabled = selected.length !== count;
  }
  form.elements.tag.onchange = () => {
    selected = [];
    limit = 24;
    list();
  };
  form.elements.query.oninput = () => { limit = 24; list(); };
  form.elements.query.onkeydown = event => { if (event.key === "Enter") event.preventDefault(); };
  $("#more-monsters").onclick = () => { limit += 24; list(); };
  form.elements.count.oninput = () => {
    selected = selected.slice(0, Number(form.elements.count.value));
    list();
  };
  $("#pool").onchange = e => {
    const i = Number(e.target.value);
    selected = e.target.checked ? [...selected, i] : selected.filter(n => n !== i);
    list();
  };
  form.onsubmit = handle(() => {
    if (selected.length !== Number(form.elements.count.value)) {
      throw Error("무리 크기만큼 골라 주세요.");
    }
    keepDraft(GEEZ.fromItems(
        "dungeon", form.elements.name.value, form.elements.tag.value, selected.map(i => all[i])));
    dialog.close();
    studio();
    notify("던전을 저장했어요.");
  });
  list();
}
