"use strict";

function keepDraft(raw) {
  // 직접 만든 문제와 가져온 JSON 모두 같은 형식 검사를 거쳐 보관한다.
  const pack = GEEZ.pack(raw);
  const id = "local-" + uid();
  saveLocal("draft", id, {
    id,
    pack,
    author: model.user?.nickname || "내 보관함",
    created: Date.now(),
    local: true
  });
  return id;
}

function exportPack(pack) {
  const blob = new Blob([JSON.stringify(pack, null, 2)], {type: "application/json"});
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = pack.name.replace(/[\\/:*?"<>|]/g, "_") + ".json";
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function studio() {
  const saved = drafts();
  main.innerHTML = `
    <h1>내 보관함</h1>
    <p>만든 문제와 던전은 먼저 이 브라우저에 저장돼요.</p>
    <div class="actions">
      <button id="new-monster">몬스터 만들기</button>
      <button id="new-dungeon">던전 만들기</button>
      <button class="quiet" id="import">JSON 가져오기</button>
      <input id="file" type="file" accept=".json,application/json" hidden>
    </div>
    <section>
      <h2>내 몬스터</h2>
      ${cards(saved.filter(e => e.pack.kind === "monster"))}
    </section>
    <section>
      <h2>내 던전</h2>
      ${cards(saved.filter(e => e.pack.kind === "dungeon"))}
    </section>`;
  $("#new-monster").onclick = monsterForm;
  $("#new-dungeon").onclick = dungeonForm;
  $("#import").onclick = () => $("#file").click();
  $("#file").onchange = handle(async e => {
    const file = e.target.files[0];
    if (!file) {
      return;
    }
    if (file.size > 1024 * 1024) {
      throw Error("1MB 이하의 퀴즈 파일을 선택해 주세요.");
    }
    let pack;
    try {
      pack = JSON.parse(await file.text());
    } catch {
      throw Error("JSON 파일을 읽을 수 없어요.");
    }
    keepDraft(pack);
    studio();
    notify("내 보관함에 가져왔어요.");
  });
}

function monsterForm() {
  const looks = [
    "새싹 슬라임", "달걀 삐약이", "딸기 버섯콩", "잎새 여우", "수정 골렘", "별모자 유령",
    "잿불 드래곤", "밤왕관 박쥐", "호박석 거북"
  ];
  const artOptions = looks.map((name, index) =>
    `<option value="${index}">${name} · ${GEEZ.difficulty(index)}</option>`).join("");
  const timeOptions = [0, 15, 30, 60, 120].map(seconds =>
    `<option value="${seconds}">${seconds ? seconds + "초" : "없음"}</option>`).join("");

  popup("몬스터 만들기", `
    <form id="make">
      <label>몬스터 이름<input name="name" maxlength="36" required></label>
      <img id="sample" class="question-art" src="art/m0.webp" alt="선택한 몬스터 외형">
      <div class="filters">
        <label>외형·난이도<select name="art">${artOptions}</select></label>
        <label>제한 시간<select name="seconds">${timeOptions}</select></label>
      </div>
      <label>태그<input name="tags" placeholder="과학, 생물 (최대 5개)" required></label>
      <label>질문<textarea name="question" maxlength="600" required></textarea></label>
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
  // 같은 문제가 여러 던전에 들어 있어도 후보 목록에는 한 번만 표시한다.
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
      <div class="picklist stack" id="pool"></div>
      <button id="save-dungeon">내 던전에 저장</button>
    </form>`);
  const form = $("#build");
  // 배열에 추가한 순서가 던전에서 몬스터를 만나는 순서다.
  let selected = [];
  function list() {
    const count = Number(form.elements.count.value);
    $("#size").textContent = count + "마리 · 선택 " + selected.length + "/" + count;
    $("#order").innerHTML = selected.map(i => '<li>' + esc(all[i].name) + '</li>').join("");
    $("#pool").innerHTML = all.map((monster, index) => {
      if (!monster.tags.includes(form.elements.tag.value)) return "";
      const checked = selected.includes(index);
      const disabled = !checked && selected.length >= count;
      return `
        <label class="choice">
          <input type="checkbox" value="${index}" ${checked ? "checked" : ""} ${disabled ? "disabled" : ""}>
          ${esc(monster.name)}
        </label>`;
    }).join("");
    $("#save-dungeon").disabled = selected.length !== count;
  }
  form.elements.tag.onchange = () => {
    selected = [];
    list();
  };
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
