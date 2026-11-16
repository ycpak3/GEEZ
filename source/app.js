"use strict";

const $ = selector => document.querySelector(selector);
const main = $("#main");
const dialog = $("#popup");
const body = $("#dialog-body");
const model = {
  online: false,
  user: null,
  shared: [],
  attempts: []
};
const esc = value => String(value).replace(
    /[&<>"']/g,
    c => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"})[c]);
const uid = () =>
    Array.from(crypto.getRandomValues(new Uint8Array(16)), n => n.toString(16).padStart(2, "0"))
        .join("");
// 같은 브라우저에서도 게스트와 각 회원의 보관함·연습 기록을 따로 저장한다.
function localPrefix(type) {
  return "geez.git.v1." + (model.user?.id || "guest") + "." + type + ".";
}

function localRows(type) {
  const prefix = localPrefix(type);
  return Object.keys(localStorage)
      .filter(k => k.startsWith(prefix))
      .map(k => JSON.parse(localStorage.getItem(k)));
}

function saveLocal(type, id, record) {
  localStorage.setItem(localPrefix(type) + id, JSON.stringify(record));
}

const drafts = () => localRows("draft").sort((a, b) => b.created - a.created);
const catalog = () => [...GEEZ.catalog, ...model.shared];
const entries = () => [...drafts(), ...catalog()];
const findEntry = id => entries().find(entry => entry.id === id);
const imagePath = item => "art/m" + Number(item.art) + ".webp";
const art = p => p.kind === "dungeon" ? "art/dungeon.webp" : imagePath(p.items[0]);
let toastTimer;
let clock;
function notify(text) {
  $("#notice").textContent = text;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    $("#notice").textContent = "";
  }, 3500);
}

function popup(title, html) {
  $("#dialog-title").textContent = title;
  $("#error").textContent = "";
  body.innerHTML = html;
  if (!dialog.open) {
    dialog.showModal();
  }
}

function handle(fn) {
  return async event => {
    event?.preventDefault();
    try {
      await fn(event);
    } catch (err) {
      if (dialog.open) {
        $("#error").textContent = err.message;
      } else {
        notify(err.message);
      }
    }
  };
}

$("#close").onclick = () => dialog.close();
dialog.addEventListener("close", () => clearInterval(clock));
async function api(route, data) {
  const result = await fetch("./api/" + route, {
    method: data ? "POST" : "GET",
    cache: "no-store",
    ...(data ? {headers: {"Content-Type": "application/json"}, body: JSON.stringify(data)} :
               {})
  });
  const response = await result.json();
  if (!result.ok) {
    throw Error(response.error || "요청을 처리하지 못했어요.");
  }
  return response;
}

async function sync() {
  const data = await api("state");
  if (data.service !== "geez") {
    throw Error("GEEZ 서버가 필요해요.");
  }
  Object.assign(model, data, {online: true});
}

function card(entry) {
  const pack = entry.pack;
  const item = pack.items[0];
  const info = pack.kind === "dungeon" ?
      pack.items.length + "마리" :
      (item.choices.length ? "선택형" : "단답형") + " · 난이도 " + GEEZ.difficulty(item.art);
  return `
    <button class="card" data-open="${esc(entry.id)}">
      <small>${esc(info)}</small>
      <img loading="lazy" src="${art(pack)}" alt="">
      <strong>${esc(pack.name)}</strong>
      <div class="tags">
        <span class="tag">#${esc(pack.tag)}</span>
        <small>${esc(entry.author)}</small>
      </div>
    </button>`;
}

function cards(list, empty = "아직 저장한 항목이 없어요.") {
  return list.length ? '<div class="grid">' + list.map(card).join("") + '</div>' :
                       '<p class="muted">' + empty + '</p>';
}

function home() {
  // 한국 시간 자정에 오늘의 몬스터를 바꾼다.
  const hourMs = 60 * 60 * 1000;
  const day = Math.floor((Date.now() + 9 * hourMs) / (24 * hourMs));
  const daily = GEEZ.catalog[day % 100];
  main.innerHTML = `
    <div class="hero">
      <div>
        <p>오늘의 몬스터</p>
        <h1>${esc(daily.pack.name)}</h1>
        <p>#${esc(daily.pack.tag)} · 첫 포획 ${GEEZ.xpFor(daily.pack.items[0].art)} XP</p>
        <div class="actions">
          <button data-open="${daily.id}">도전하기</button>
          <a class="button secondary" href="#explore">전체 탐색</a>
        </div>
      </div>
      <img src="${art(daily.pack)}" alt="">
    </div>
    <section>
      <div class="title-row">
        <h2>분야별 던전</h2>
        <a href="#studio">던전 만들기 →</a>
      </div>
      ${cards(GEEZ.catalog.filter(e => e.pack.kind === "dungeon"))}
    </section>
    <section>
      <h2>추천 몬스터</h2>
      ${cards(GEEZ.catalog.slice(0, 4))}
    </section>`;
}

function explore() {
  const list = catalog();
  const tags = [...new Set(list.flatMap(e => e.pack.items.flatMap(m => m.tags)))];
  main.innerHTML = `
    <h1>몬스터·던전 탐색</h1>
    <div class="filters">
      <input id="query" type="search" placeholder="이름이나 문제 내용 검색" aria-label="검색어">
      <select id="kind" aria-label="콘텐츠 종류">
        <option value="">전체 종류</option>
        <option value="monster">몬스터</option>
        <option value="dungeon">던전</option>
      </select>
      <select id="tag" aria-label="태그">
        <option value="">모든 태그</option>
        ${tags.map(t => '<option>' + esc(t) + '</option>').join("")}
      </select>
    </div>
    <p id="count"></p>
    <div id="results"></div>`;
  function search() {
    const query = $("#query").value.trim().toLowerCase();
    const selectedTag = $("#tag").value;
    const selectedKind = $("#kind").value;
    const results = list.filter(({ pack }) => {
      if (selectedKind && selectedKind !== pack.kind) return false;
      if (selectedTag && !pack.items.some(item => item.tags.includes(selectedTag))) return false;

      const fields = [pack.name, pack.tag, ...pack.items.flatMap(item => [item.question, ...item.tags])];
      return fields.some(value => value.toLowerCase().includes(query));
    });
    $("#count").textContent = "검색 결과 " + results.length + "개";
    $("#results").innerHTML = cards(results, "조건에 맞는 문제가 없어요.");
  }
  for (const i of ["#query", "#tag", "#kind"]) {
    $(i).oninput = search;
  }
  search();
}

function stats() {
  const local = localRows("try").sort((a, b) => a.at - b.at);
  const all = [...local, ...model.attempts].sort((a, b) => a.at - b.at);
  const summary = GEEZ.summarize(all);
  const rate = summary.total ? Math.round(summary.first / summary.total * 100) + "%" : "—";
  const metric = (label, value) =>
      '<div class="metric"><small>' + label + '</small><strong>' + value + '</strong></div>';
  const titles = rows => rows.length ?
      rows.map(r => '<li>' + esc(r.item.name) + ' · ' + r.tries + '회 도전</li>').join("") :
      '<li>도전 기록이 없어요.</li>';
  const recordSource = model.user
    ? esc(model.user.nickname) + "의 회원 기록과 이 브라우저의 보관함 연습 기록"
    : "이 브라우저에 저장된 게스트 기록";
  const tagRows = [...summary.tags].map(([tag, record]) => `
    <tr>
      <td>${esc(tag)}</td>
      <td>${record.right} / ${record.total}</td>
      <td>${record.caught}마리</td>
    </tr>`).join("");

  main.innerHTML = `
    <h1>탐험가 상태창</h1>
    <p class="muted">${recordSource}</p>
    <section class="metrics">
      ${metric("레벨", 1 + Math.floor(summary.xp / 100))}
      ${metric("누적 경험치", summary.xp + " XP")}
      ${metric("포획 몬스터", summary.caught + "마리")}
      ${metric("첫 도전 정답률", rate)}
    </section>
    <section>
      <h2>태그별 학습 기록</h2>
      <table>
        <thead><tr><th>태그</th><th>첫 도전 정답</th><th>포획</th></tr></thead>
        <tbody>${tagRows}</tbody>
      </table>
    </section>
    <section class="panel">
      <h2>포획 도감</h2>
      <ul class="compact">${titles(summary.records.filter(r => r.caught))}</ul>
    </section>
    <section class="panel">
      <h2>첫 도전 오답 도감</h2>
      <ul class="compact">${titles(summary.records.filter(r => !r.first))}</ul>
    </section>`;
}

function detail(entry) {
  if (!entry) {
    throw Error("현재 기기 또는 서버에서 해당 도전을 찾을 수 없어요.");
  }
  const pack = entry.pack;
  const overview = pack.kind === "dungeon"
    ? `<ol>${pack.items.map(item => `<li>${esc(item.name)}</li>`).join("")}</ol>`
    : `<p>난이도 ${GEEZ.difficulty(pack.items[0].art)} · 첫 포획 ${GEEZ.xpFor(pack.items[0].art)} XP</p>`;
  const canPublish = entry.local && !entry.received && model.user;

  popup(pack.name, `
    <img class="question-art" src="${art(pack)}" alt="">
    <p>${esc(entry.author)} · #${esc(pack.tag)}</p>
    ${overview}
    <div class="actions">
      <button id="start">도전 시작</button>
      <button class="quiet" id="export">JSON 내보내기</button>
      ${location.protocol !== "file:" ? '<button class="quiet" id="share">링크 복사</button>' : ""}
      ${entry.received ? '<button class="quiet" id="keep">내 보관함에 저장</button>' : ""}
      ${canPublish ? '<button class="quiet" id="publish">공용 목록에 등록</button>' : ""}
    </div>`);
  $("#start").onclick = handle(() => play(entry, 0, 0));
  $("#export").onclick = () => exportPack(pack);
  if ($("#share")) {
    $("#share").onclick = handle(() => copyLink(entry));
  }
  if ($("#keep")) {
    $("#keep").onclick = handle(() => {
      keepDraft(entry.pack);
      dialog.close();
      location.hash = "studio";
      notify("받은 도전을 저장했어요.");
    });
  }
  if ($("#publish")) {
    $("#publish").onclick = handle(async () => {
      const result = await api("publish", {pack: pack, draftId: entry.id});
      await sync();
      detail(findEntry(result.id));
      notify("공용 목록에 등록했어요.");
    });
  }
}

async function copyLink(entry) {
  const url = new URL(location.href);
  // 보관함 문제는 링크에 내용까지 담고, 공용 문제는 목록의 ID로 찾아간다.
  url.hash = entry.local ? "share=" + encodeURIComponent(JSON.stringify(entry.pack)) :
                           "quest/" + entry.id;
  if (url.href.length > 32000) {
    throw Error("이 던전은 링크가 길어져요. JSON 내보내기로 공유해 주세요.");
  }
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(url.href);
      notify("도전 링크를 복사했어요.");
      return;
    } catch {
    }
  }
  popup("도전 링크", '<label>복사할 주소<input id="link" readonly></label>');
  $("#link").value = url.href;
  $("#link").select();
}

async function play(entry, index, points) {
  clearInterval(clock);
  const pack = entry.pack;
  const item = pack.items[index];
  // 로그인한 회원이 공용 문제를 풀면 서버가 채점한다. 보관함 문제는 브라우저에서 채점한다.
  const remote = Boolean(model.user && !entry.local);
  const round = remote ? await api("start", {id: entry.id, index}) :
                         {deadline: item.seconds ? Date.now() + item.seconds * 1000 : 0};
  const answerField = item.choices.length
    ? item.choices.map(choice => `
        <label class="choice">
          <input type="radio" name="answer" value="${esc(choice)}" required>${esc(choice)}
        </label>`).join("")
    : '<label>내 답<input name="answer" autocomplete="off" maxlength="100" required></label>';

  popup(item.name, `
    <p class="muted">${index + 1} / ${pack.items.length} · #${esc(pack.tag)} <span id="timer"></span></p>
    <img class="question-art" src="${imagePath(item)}" alt="">
    <h3>${esc(item.question)}</h3>
    <form id="answer">
      ${answerField}
      <button>답안 제출</button>
    </form>`);
  // 제출 버튼과 제한 시간 타이머가 동시에 채점을 요청할 수 있다.
  let busy = false;
  async function submit() {
    if (busy) {
      return;
    }
    busy = true;
    try {
      const value = String(new FormData($("#answer")).get("answer") || "").trim();
      let expired = Boolean(round.deadline && Date.now() >= round.deadline);
      let correct;
      if (!expired && !value) {
        throw Error("답을 입력해 주세요.");
      }
      if (remote) {
        const result = await api("answer", {rid: round.rid, answer: value});
        correct = result.correct;
        expired = result.expired;
        await sync();
      } else {
        correct = !expired && GEEZ.grade(item, value);
        saveLocal("try", uid(), {item, correct, at: Date.now()});
      }
      clearInterval(clock);
      const score = points + Number(correct);
      const title = expired ? "시간이 끝났어요" : correct ? "몬스터 포획 성공" : "다음 도전에 다시 만나요";
      const nextLabel = index + 1 < pack.items.length ? "다음 몬스터" : "결과 보기";
      popup(title, `
        <img class="question-art" src="${imagePath(item)}" alt="">
        <p><b>정답</b> ${esc(item.answers.join(", "))}</p>
        <p>${esc(item.explain)}</p>
        <div class="actions">
          <button id="next">${nextLabel}</button>
          <button class="quiet" id="retry">같은 문제 다시 풀기</button>
        </div>`);
      $("#retry").onclick = handle(() => play(entry, index, points));
      $("#next").onclick = handle(() => {
        if (index + 1 < pack.items.length) {
          return play(entry, index + 1, score);
        }
        popup(
            "탐험 완료",
            '<p>' + esc(pack.name) + ' · ' + pack.items.length + '문제 중 ' + score +
                '문제 정답</p><button id="seeStats">상태창 보기</button>');
        $("#seeStats").onclick = () => {
          dialog.close();
          location.hash = "stats";
          render();
        };
      });
    } catch (err) {
      busy = false;
      throw err;
    }
  }
  $("#answer").onsubmit = handle(submit);
  if (round.deadline) {
    function tick() {
      const n = Math.max(0, Math.ceil((round.deadline - Date.now()) / 1000));
      $("#timer").textContent = " · " + n + "초";
      if (!n) {
        clearInterval(clock);
        handle(submit)();
      }
    }
    clock = setInterval(tick, 300);
    tick();
  }
}

function account(signup = false) {
  if (model.user) {
    popup(model.user.nickname, '<button id="logout">로그아웃</button>');
    $("#logout").onclick = handle(async () => {
      await api("logout", {});
      await sync();
      dialog.close();
      render();
    });
    return;
  }
  const nicknameField = signup
    ? '<label>닉네임<input name="nickname" maxlength="16" required></label>'
    : "";
  popup(signup ? "회원가입" : "로그인", `
    <form id="auth">
      <label>아이디
        <input name="login" required pattern="[A-Za-z0-9_]{4,24}"
               placeholder="영문·숫자·밑줄 4~24자" autocomplete="username">
      </label>
      ${nicknameField}
      <label>비밀번호
        <input type="password" name="password" minlength="${signup ? 12 : 1}" maxlength="128"
               autocomplete="${signup ? "new-password" : "current-password"}" required>
      </label>
      <button>${signup ? "가입하기" : "로그인"}</button>
    </form>
    <p><button class="quiet" id="switch">${signup ? "로그인 화면" : "회원가입"}</button></p>`);
  $("#switch").onclick = () => account(!signup);
  $("#auth").onsubmit = handle(async e => {
    await api(signup ? "signup" : "login", Object.fromEntries(new FormData(e.target)));
    await sync();
    dialog.close();
    render();
  });
}

function render() {
  if (dialog.open) {
    dialog.close();
  }
  const route = location.hash.slice(1) || "home";
  $("#account").hidden = !model.online;
  $("#account").textContent = model.user?.nickname || "로그인";
  $("#account").onclick = () => account();
  for (const a of document.querySelectorAll("nav a")) {
    if (a.hash === "#" + route) {
      a.setAttribute("aria-current", "page");
    } else {
      a.removeAttribute("aria-current");
    }
  }
  if (route === "studio") {
    studio();
  } else if (route === "stats") {
    stats();
  } else if (route === "explore") {
    explore();
  } else {
    home();
    if (route.startsWith("quest/")) {
      handle(() => detail(findEntry(route.slice(6))))();
    }
    if (route.startsWith("share=")) {
      handle(() => {
        if (route.length > 32000) {
          throw Error("공유 링크가 너무 길어요. JSON 파일로 받아 주세요.");
        }
        let pack;
        try {
          pack = GEEZ.pack(JSON.parse(decodeURIComponent(route.slice(6))));
        } catch {
          throw Error("올바른 GEEZ 공유 링크를 열어 주세요.");
        }
        detail({pack, author: "받은 도전", received: true, local: true});
      })();
    }
  }
}

main.addEventListener("click", event => {
  const button = event.target.closest("[data-open]");
  if (button) {
    handle(() => detail(findEntry(button.dataset.open)))();
  }
});
window.addEventListener("hashchange", render);
window.addEventListener("DOMContentLoaded", async () => {
  if (["localhost", "127.0.0.1"].includes(location.hostname)) {
    try {
      await sync();
    } catch {
    }
  }
  render();
});
