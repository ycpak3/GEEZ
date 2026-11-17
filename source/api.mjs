import {createHash, randomBytes, randomUUID, timingSafeEqual} from "node:crypto";
import {Buffer} from "node:buffer";
import "./rules.js";
import {overviewStats, questionStats} from "./community.mjs";
import {readCatalog, readPublicItem} from "./db/catalog.mjs";

const digest = value => createHash("sha256").update(value).digest("hex");
export function fail(message, status = 400) {
  throw Object.assign(new Error(message), {status});
}

// 로컬 서버와 Workers의 세션·공유·채점 API 공통 구현
export function createApi({db, hashPassword, limitAuth, search}) {
  const sessionLifetimeSeconds = 7 * 24 * 60 * 60;
  function tokenOf(req) {
    return req.cookie?.match(/(?:^|;\s*)geez_session=([a-f0-9]{64})(?:;|$)/)?.[1] || "";
  }

  async function account(req) {
    const token = tokenOf(req);
    if (!token) return null;
    const user = await db.first(`
      SELECT u.id, u.nickname
      FROM geez_users u JOIN geez_sessions s ON u.id = s.user
      WHERE s.token = ? AND s.expires > ?
    `, digest(token), Date.now());
    return user || null;
  }

  // 쿠키에 원본 토큰 발급 후 DB에는 조회용 해시 저장
  async function issueSession(req, res, user) {
    const token = randomBytes(32).toString("hex");
    await db.run(
        `DELETE FROM geez_sessions WHERE expires<=? OR token=?`, Date.now(), digest(tokenOf(req)));
    const expires = Date.now() + sessionLifetimeSeconds * 1000;
    await db.run(`INSERT INTO geez_sessions VALUES(?,?,?)`, digest(token), user, expires);
    res.set(
        "Set-Cookie",
        "geez_session=" + token + "; HttpOnly; SameSite=Strict; Path=/; Max-Age=" +
            sessionLifetimeSeconds + (req.secure ? "; Secure" : ""));
  }

  async function authenticate(mode, credentials, req, res) {
    await limitAuth(req);
    const login = String(credentials.login || "").normalize("NFKC").trim().toLowerCase();
    if (!/^[a-z0-9_]{4,24}$/.test(login) || typeof credentials.password !== "string" ||
        !credentials.password || credentials.password.length > 128) {
      fail("아이디 또는 비밀번호 형식을 확인해 주세요.");
    }
    let user;
    if (mode === "signup") {
      const nickname = String(credentials.nickname || "").normalize("NFKC").trim();
      if (!/^[가-힣A-Za-z0-9_]{2,16}$/.test(nickname) || nickname.toLowerCase() === "master" ||
          login === "master") {
        fail("닉네임은 한글·영문·숫자·밑줄 2~16자예요. Master는 예약된 이름이에요.");
      }
      if (credentials.password.length < 12) {
        fail("비밀번호는 12자 이상이어야 해요.");
      }
      const id = randomUUID();
      const salt = randomBytes(16).toString("hex");
      const hash = (await hashPassword(credentials.password, salt)).toString("hex");
      const insert = await db.run(
          `INSERT OR IGNORE INTO geez_users VALUES(?,?,?,?,?)`, id, login, nickname, salt, hash);
      if (!insert) {
        fail("이미 사용 중인 아이디 또는 닉네임이에요.", 409);
      }
      user = id;
    } else {
      const row = await db.first(`SELECT * FROM geez_users WHERE login=?`, login);
      const test =
          await hashPassword(credentials.password, row?.salt || "00000000000000000000000000000000");
      if (!row || !timingSafeEqual(test, Buffer.from(row.hash, "hex"))) {
        fail("아이디 또는 비밀번호를 확인해 주세요.", 401);
      }
      user = row.id;
    }
    await issueSession(req, res, user);
    return {ok: true};
  }

  async function state(user) {
    const shared = (await db.all(`
      SELECT p.id, p.owner, p.draft, p.content, u.nickname
      FROM geez_packs p JOIN geez_users u ON u.id = p.owner
      ORDER BY p.rowid DESC
    `)).map(row => ({
      id: row.id, author: row.nickname, pack: JSON.parse(row.content),
      ...(row.owner === user?.id ? {ownDraftId: row.draft} : {})
    }));

    // 공용 목록과 로그인한 회원 본인의 풀이 이력 조회
    let attempts = [];
    if (user) {
      const rounds = await db.all(`
        SELECT item, correct, finish FROM geez_rounds
        WHERE user = ? AND finish IS NOT NULL
        ORDER BY finish, rowid
      `, user.id);
      attempts = rounds.map(row => ({
        item: JSON.parse(row.item),
        correct: Boolean(row.correct),
        at: row.finish
      }));
    }
    return {service: "geez", user, shared, attempts};
  }

  async function similarQuestions({question, scope, kind = "", tag = ""}) {
    const exploring = scope === "explore";
    const minimum = exploring ? 2 : 3;
    if (typeof question !== "string" || question.trim().length < minimum || question.length > 600) {
      fail(`질문을 ${minimum}~600자로 입력해 주세요.`);
    }
    if (exploring &&
        (!["", "monster", "dungeon"].includes(kind) || typeof tag !== "string" || tag.length > 16)) {
      fail("검색 조건을 확인해 주세요.");
    }
    const query = question.trim();
    const recent = await db.all(`SELECT id, content FROM geez_packs ORDER BY rowid DESC LIMIT 100`);
    const published = recent.map(row => ({id: row.id, pack: JSON.parse(row.content)}));
    const builtin = await readCatalog(db);
    const entries = [...builtin, ...published];
    const sources = new Map();
    for (const entry of entries) {
      const pack = entry.pack;
      if (exploring && (!GEEZ.matchesFilters(pack, kind, tag) || GEEZ.matchesQuery(pack, query)))
        continue;
      for (const item of pack.items) {
        if (exploring && tag && !item.tags.includes(tag)) continue;
        const previous = sources.get(item.question);
        // 던전과 단독 몬스터의 문항이 겹치면 단독 몬스터 우선
        if ((!previous && sources.size < 1000) ||
            (previous?.pack.kind === "dungeon" && pack.kind === "monster")) {
          sources.set(item.question, entry);
        }
      }
    }
    if (!sources.size) return {matches: []};
    const result = await search({query, questions: [...sources.keys()]});
    if (!exploring) return result;
    return {matches: result.matches.map(match => ({...match, id: sources.get(match.question).id}))};
  }

  // 공개 작품 안에서 문항을 찾아 채점과 통계 조회에 같은 원본 사용
  async function publicItem(data) {
    if (typeof data.id !== "string" || !Number.isInteger(data.index)) {
      fail("문제를 다시 선택해 주세요.");
    }
    const item = await readPublicItem(db, data.id, data.index);
    if (!item) {
      fail("등록한 문제를 찾을 수 없어요.", 404);
    }
    return item;
  }

  async function operation(route, data, req, res) {
    if (route === "catalog") return {entries: await readCatalog(db)};
    if (route === "community") return overviewStats(db);
    if (route === "question-stats") return questionStats(db, await publicItem(data));
    if (route === "similar") return similarQuestions(data);
    if (route === "signup" || route === "login") {
      return authenticate(route, data, req, res);
    }
    const user = await account(req);
    if (route === "state") return state(user);
    if (!user) {
      fail("로그인이 필요해요.", 401);
    }

    if (route === "delete-pack") {
      if (data.accountId !== user.id || !/^local-[a-f0-9]{32}$/.test(data.draftId)) {
        fail("계정과 작품을 다시 확인해 주세요.", 403);
      }
      await db.run("DELETE FROM geez_packs WHERE owner = ? AND draft = ?", user.id, data.draftId);
      return {ok: true};
    }

    if (route === "withdraw" || route === "logout") {
      if (route === "withdraw") {
        await limitAuth(req);
        if (data.accountId !== user.id || typeof data.password !== "string" ||
            !data.password || data.password.length > 128) fail("계정과 비밀번호를 확인해 주세요.", 403);
        const row = await db.first("SELECT salt, hash FROM geez_users WHERE id = ?", user.id);
        if (!row || !timingSafeEqual(await hashPassword(data.password, row.salt), Buffer.from(row.hash, "hex"))) {
          fail("현재 비밀번호를 확인해 주세요.", 403);
        }
        // 관련 기록과 계정을 한 트랜잭션으로 삭제
        await db.batch([
          "DELETE FROM geez_rounds WHERE user = ?",
          "DELETE FROM geez_packs WHERE owner = ?",
          "DELETE FROM geez_sessions WHERE user = ?",
          "DELETE FROM geez_users WHERE id = ?"
        ], user.id);
      } else {
        await db.run("DELETE FROM geez_sessions WHERE token=?", digest(tokenOf(req)));
      }
      res.set(
          "Set-Cookie",
          "geez_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0" + (req.secure ? "; Secure" : ""));
      return {ok: true};
    }

    if (route === "publish") {
      if (typeof data.draftId !== "string" || !/^local-[a-f0-9]{32}$/.test(data.draftId)) {
        fail("보관함 식별자가 잘못됐어요.");
      }
      let pack;
      try {
        pack = GEEZ.pack(data.pack);
      } catch (err) {
        fail(err.message);
      }
      await db.run(
          `
        INSERT INTO geez_packs VALUES (?, ?, ?, ?)
        ON CONFLICT(owner, draft) DO NOTHING
      `,
          randomUUID(), user.id, data.draftId, JSON.stringify(pack));
      return await db.first(
          `SELECT id FROM geez_packs WHERE owner=? AND draft=?`, user.id, data.draftId);
    }

    if (route === "start") {
      const item = await publicItem(data);
      const rid = randomUUID();
      const deadline = item.seconds ? Date.now() + item.seconds * 1000 : 0;
      await db.run(
          `INSERT INTO geez_rounds(id,user,item,deadline) VALUES(?,?,?,?)`, rid, user.id,
          JSON.stringify(item), deadline);
      return {rid, deadline};
    }

    if (route === "answer") {
      if (typeof data.rid !== "string" || typeof data.answer !== "string" || data.answer.length > 100) {
        fail("답안을 확인해 주세요.");
      }
      const row =
          await db.first(`SELECT * FROM geez_rounds WHERE id=? AND user=?`, data.rid, user.id);
      if (!row) {
        fail("도전을 찾을 수 없어요.", 404);
      }
      // 동일한 도전의 재전송에는 처음 저장한 채점 결과 반환
      if (row.finish !== null) {
        return {correct: Boolean(row.correct), expired: Boolean(row.expired)};
      }
      const item = JSON.parse(row.item);
      const now = Date.now();
      const expired = Boolean(row.deadline && now >= row.deadline);
      if (!expired &&
          (!data.answer.trim() || (item.choices.length && !item.choices.includes(data.answer)))) {
        fail("답을 선택하거나 입력해 주세요.");
      }
      const correct = !expired && GEEZ.grade(item, data.answer);
      await db.run(
          `
        UPDATE geez_rounds SET finish = ?, correct = ?, expired = ?
        WHERE id = ? AND finish IS NULL
      `,
          now, Number(correct), Number(expired), data.rid);
      const saved = await db.first(
          `SELECT correct, expired FROM geez_rounds WHERE id=? AND user=?`, data.rid, user.id);
      return {correct: Boolean(saved.correct), expired: Boolean(saved.expired)};
    }
    fail("없는 요청이에요.", 404);
  }
  return operation;
}
