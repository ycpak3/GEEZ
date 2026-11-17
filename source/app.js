"use strict";

const $ = selector => document.querySelector(selector);
const main = $("#main");
const dialog = $("#popup");
const body = $("#dialog-body");
const model = {
  online: false,
  builtin: [],
  catalogError: "",
  user: null,
  shared: [],
  attempts: []
};
const esc = value => String(value).replace(
    /[&<>"']/g, c => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"})[c]);
const uid = () =>
    Array.from(crypto.getRandomValues(new Uint8Array(16)), n => n.toString(16).padStart(2, "0")).join("");
// 게스트와 회원별로 보관함·연습 기록 분리
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
const catalog = () => [...model.builtin, ...model.shared];
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

function popup(title, html, result = "") {
  dialog.dataset.result = result;
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
async function api(route, data, signal) {
  const result = await fetch("./api/" + route, {
    method: data ? "POST" : "GET",
    cache: "no-store",
    signal,
    ...(data ? {headers: {"Content-Type": "application/json"}, body: JSON.stringify(data)} : {})
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
  // 한국 시간 자정을 기준으로 오늘의 몬스터 선택
  const hourMs = 60 * 60 * 1000;
  const day = Math.floor((Date.now() + 9 * hourMs) / (24 * hourMs));
  const monsters = model.builtin.filter(entry => entry.pack.kind === "monster");
  if (!monsters.length) {
    main.innerHTML = `<h1>탐험 홈</h1><p role="status">${esc(model.catalogError || "기본 문항을 불러오는 중이에요.")}</p>
      <a class="button secondary" href="#studio">내 보관함</a>`;
    return;
  }
  const daily = monsters[day % monsters.length];
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
      ${cards(model.builtin.filter(e => e.pack.kind === "dungeon"))}
    </section>
    <section>
      <h2>추천 몬스터</h2>
      ${cards(model.builtin.slice(0, 4))}
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
    ${model.catalogError ? '<p role="status">' + esc(model.catalogError) + '</p>' : ""}
    <p id="count" role="status"></p>
    <div id="results"></div>
    <div id="related" aria-live="polite"></div>`;
  const related = $("#related");
  let delay;
  let pending;

  async function showRelated(question, kind, tag, signal) {
    if (!related.isConnected || signal.aborted) return;
    related.textContent = "비슷한 문항을 찾는 중이에요.";
    try {
      const {matches} = await api("similar", {scope: "explore", question, kind, tag}, signal);
      if (signal.aborted || !related.isConnected) return;
      const rows = matches.flatMap(match => {
        const entry = listById.get(match.id);
        if (!entry) return [];
        const label = entry.pack.kind === "dungeon" ? "던전" : "몬스터";
        return [`<button class="related-hit" data-open="${esc(entry.id)}">
          <strong>${esc(match.question)}</strong>
          <small>${label} · ${esc(entry.pack.name)} · 표현 유사도 ${
            Math.round(match.score * 100)}%</small>
        </button>`];
      });
      related.innerHTML = rows.length ?
          '<section><h2>비슷한 문항</h2><div class="stack">' + rows.join("") + '</div></section>' :
          '<p class="muted">비슷한 문항이 없어요.</p>';
    } catch {
      if (!signal.aborted && related.isConnected)
        related.textContent = "비슷한 문항을 불러오지 못했어요.";
    }
  }

  const listById = new Map(list.map(entry => [entry.id, entry]));
  let visibleCount;
  function search() {
    visibleCount = 36;
    clearTimeout(delay);
    pending?.abort();
    related.replaceChildren();
    const query = $("#query").value.trim();
    const selectedTag = $("#tag").value;
    const selectedKind = $("#kind").value;
    const results = list.filter(
        ({pack}) =>
            GEEZ.matchesFilters(pack, selectedKind, selectedTag) && GEEZ.matchesQuery(pack, query));
    $("#count").textContent = (query ? "검색 문구 일치 " : "검색 결과 ") + results.length + "개";
    function displayPage() {
      $("#results").innerHTML = results.length || !query ?
          cards(results.slice(0, visibleCount), "조건에 맞는 문제가 없어요.") :
          "";
      if (visibleCount < results.length) {
        const more = document.createElement("button");
        more.className = "quiet more";
        more.textContent = "더 보기 (" + visibleCount + "/" + results.length + ")";
        more.onclick = () => {
          visibleCount += 36;
          displayPage();
        };
        $("#results").append(more);
      }
    }
    displayPage();
    if (model.online && query.length >= 2 && query.length <= 600) {
      pending = new AbortController();
      const {signal} = pending;
      delay = setTimeout(() => showRelated(query, selectedKind, selectedTag, signal), 350);
    }
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
  const recordSource = model.user ?
      esc(model.user.nickname) + "의 회원 기록과 이 브라우저의 보관함 연습 기록" :
      "이 브라우저에 저장된 게스트 기록";
  const review = GEEZ.reviewDungeon(summary, entries());
  const missed = review?.rounds.filter(row => row.previousMiss).length || 0;
  const reviewDescription = review ?
      `#${esc(review.pack.tag)} · 이전 오답 ${missed}문제 · 새 문제 ${review.rounds.length - missed}개` :
      "한 태그에서 서로 다른 문제를 3개 이상 풀면, 첫 도전 오답이 있는 분야로 복습 던전을 만들어요.";
  const tagRows = [...summary.tags]
                      .map(([tag, record]) => `
    <tr>
      <td>${esc(tag)}</td>
      <td>${record.right} / ${record.total} (${Math.round(record.right / record.total * 100)}%)</td>
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
      <h2>내 태그별 학습 기록</h2>
      ${tagChart(Object.fromEntries([...summary.tags].map(([tag, row]) => [tag, row.right])))}
      <table>
        <thead><tr><th>태그</th><th>첫 도전 정답</th><th>포획</th></tr></thead>
        <tbody>${
      tagRows || '<tr><td colspan="3">첫 문제를 풀면 여기에 내 기록이 쌓여요.</td></tr>'}</tbody>
      </table>
    </section>
    <section class="panel"><h2>전체 사용자 통계</h2><div id="community">불러오는 중…</div></section>
    <section class="panel">
      <h2>맞춤 복습 던전</h2>
      <p>${reviewDescription}</p>
      ${review ? '<button id="review">복습 던전 시작</button>' : ""}
    </section>
    <section class="panel">
      <h2>포획 도감</h2>
      <ul class="compact">${titles(summary.records.filter(r => r.caught))}</ul>
    </section>
    <section class="panel">
      <h2>첫 도전 오답 도감</h2>
      <ul class="compact">${titles(summary.records.filter(r => !r.first))}</ul>
    </section>`;
  showCommunity();
  if (review) $("#review").onclick = handle(() => play(review, 0, 0));
}

function detail(entry) {
  if (!entry) {
    throw Error("현재 기기 또는 서버에서 해당 도전을 찾을 수 없어요.");
  }
  const pack = entry.pack;
  const overview = pack.kind === "dungeon" ?
      `<ol>${pack.items.map(item => `<li>${esc(item.name)}</li>`).join("")}</ol>` :
      `<p>난이도 ${GEEZ.difficulty(pack.items[0].art)} · 첫 포획 ${GEEZ.xpFor(pack.items[0].art)} XP</p>`;
  const canPublish = entry.local && !entry.received && model.user;

  popup(pack.name, `
    <img class="question-art" src="${art(pack)}" alt="">
    <p>${esc(entry.author)} · #${esc(pack.tag)}</p>
    ${overview}
    ${pack.kind === "monster" ? '<div id="question-stats"></div>' : ""}
    <div class="actions">
      <button id="start">도전 시작</button>
      ${location.protocol !== "file:" ? '<button class="quiet" id="share">링크 복사</button>' : ""}
      ${entry.received ? '<button class="quiet" id="keep">내 보관함에 저장</button>' : ""}
      ${canPublish ? '<button class="quiet" id="publish">공용 목록에 등록</button>' : ""}
      ${(entry.local && !entry.received) || entry.ownDraftId ? '<button class="quiet danger" id="remove-pack">삭제</button>' : ""}
    </div>`);
  if (pack.kind === "monster") showQuestionStats({id: entry.id, index: 0, local: entry.local});
  $("#start").onclick = handle(() => play(entry, 0, 0));
  if ($("#remove-pack")) $("#remove-pack").onclick = () => confirmPackRemoval(entry, $("#draft-search")?.value);
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
  // 보관함 작품은 내용으로, 공용 작품은 공개 ID로 공유
  url.hash =
      entry.local ? "share=" + encodeURIComponent(JSON.stringify(entry.pack)) : "quest/" + entry.id;
  if (url.href.length > 32000) {
    throw Error("이 던전은 링크가 길어져요. 로그인 후 공용 목록에 등록해 짧은 링크를 복사해 주세요.");
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

async function play(entry, index, points, recovered = 0) {
  clearInterval(clock);
  const pack = entry.pack;
  const item = pack.items[index];
  // 회원의 공개 도전은 서버에서, 개인 연습은 브라우저에서 채점
  const source = entry.rounds?.[index] || {local: entry.local, id: entry.id, index};
  const remote = Boolean(model.user && !source.local);
  const round = remote ? await api("start", {id: source.id, index: source.index}) :
                         {deadline: item.seconds ? Date.now() + item.seconds * 1000 : 0};
  const answerField = item.choices.length ?
      item.choices
          .map(choice => `
        <label class="choice">
          <input type="radio" name="answer" value="${esc(choice)}" required>${esc(choice)}
        </label>`)
          .join("") :
      '<label>내 답<input name="answer" autocomplete="off" maxlength="100" required></label>';

  popup(item.name, `
    <p class="muted">${index + 1} / ${pack.items.length} · #${esc(pack.tag)} <span id="timer"></span></p>
    <img class="question-art" src="${imagePath(item)}" alt="">
    <h3>${esc(item.question)}</h3>
    <form id="answer">
      ${answerField}
      <button>답안 제출</button>
    </form><div id="question-stats"></div>`);
  showQuestionStats(source);
  // 제출 버튼과 제한 시간 만료의 중복 채점 방지
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
      const recoveredTotal = recovered + Number(Boolean(source.previousMiss && correct));
      const title = correct ? "몬스터 포획 성공!" : "몬스터 포획 실패...";
      const nextLabel = index + 1 < pack.items.length ? "다음 몬스터" : "결과 보기";
      popup(
          title, `
        ${expired ? "<p>제한 시간이 끝났어요.</p>" : ""}
        <img class="question-art" src="${imagePath(item)}" alt="">
        <p><b>정답</b> ${esc(item.answers.join(", "))}</p>
        <p>${esc(item.explain)}</p>
        <div id="question-stats"></div>
        <div class="actions">
          <button id="next">${nextLabel}</button>
          ${entry.rounds ? "" : '<button class="quiet" id="retry">같은 문제 다시 풀기</button>'}
        </div>`,
          correct ? "success" : "failure");
      showQuestionStats(source);
      if ($("#retry")) $("#retry").onclick = handle(() => play(entry, index, points));
      $("#next").onclick = handle(() => {
        if (index + 1 < pack.items.length) {
          return play(entry, index + 1, score, recoveredTotal);
        }
        const previousMisses = entry.rounds?.filter(row => row.previousMiss).length;
        const reviewResult =
            previousMisses ? `<p>이전 오답 ${previousMisses}문제 중 ${recoveredTotal}문제 정답</p>` : "";
        popup(
            entry.rounds ? "복습 완료" : "탐험 완료",
            '<p>' + esc(pack.name) + ' · ' + pack.items.length + '문제 중 ' + score + '문제 정답</p>' +
                reviewResult + '<button id="seeStats">상태창 보기</button>');
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
    popup(model.user.nickname, `<div class="actions"><button id="logout">로그아웃</button>
      <button id="withdraw" class="quiet danger">회원 탈퇴</button></div>`);
    $("#withdraw").onclick = withdrawalForm;
    $("#logout").onclick = handle(async () => {
      await api("logout", {});
      await sync();
      dialog.close();
      render();
    });
    return;
  }
  const nicknameField =
      signup ? '<label>닉네임<input name="nickname" maxlength="16" required></label>' : "";
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

function withdrawalForm() {
  const accountId = model.user.id;
  const prefixes = [localPrefix("draft"), localPrefix("try")];
  popup("회원 탈퇴", `<form id="withdraw-form">
    <p>탈퇴하면 계정, 공개한 작품, 회원 풀이 기록과 이 브라우저의 내 보관함이 삭제돼요.
       삭제한 데이터는 복구할 수 없어요.</p>
    <label>현재 비밀번호<input type="password" name="password" autocomplete="current-password"
      maxlength="128" required></label>
    <div class="actions"><button type="button" class="quiet" id="cancel-withdraw">취소</button>
      <button type="submit" class="danger">계정 삭제 및 탈퇴</button></div></form>`);
  $("#cancel-withdraw").onclick = () => account();
  $("#withdraw-form").onsubmit = handle(async event => {
    const form = event.currentTarget;
    const submit = form.querySelector('[type="submit"]');
    submit.disabled = true;
    try {
      await api("withdraw", {accountId, password: form.elements.password.value});
      for (const key of Object.keys(localStorage)) {
        if (prefixes.some(prefix => key.startsWith(prefix))) localStorage.removeItem(key);
      }
      model.user = null;
      model.attempts = [];
      model.shared = model.shared.filter(entry => !entry.ownDraftId);
      location.hash = "home";
      render();
      notify("회원 탈퇴가 완료됐어요.");
    } finally {
      submit.disabled = false;
    }
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
          throw Error("공유 링크가 너무 길어요. 공용 목록에 등록한 짧은 링크를 받아 주세요.");
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
  if (["http:", "https:"].includes(location.protocol)) {
    // 기본 목록은 최초 한 번만 조회하고 회원 기록은 제출·로그인 후 별도 갱신
    await Promise.allSettled([
      sync(),
      api("catalog").then(({entries}) => {
        if (!Array.isArray(entries)) throw Error("기본 목록 형식 오류");
        model.builtin = entries;
        if (!entries.length) model.catalogError = "등록된 기본 문항이 없어요.";
      }).catch(() => {
        model.catalogError = "기본 문항을 불러오지 못했어요. 서버 연결 후 새로고침해 주세요.";
      })
    ]);
  } else {
    model.catalogError = "기본 문항을 보려면 서버를 실행하고 웹 주소로 열어 주세요.";
  }
  render();
});
