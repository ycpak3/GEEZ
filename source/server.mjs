// 선택 실행: node source/server.mjs  (Node.js 22.13 이상)
// (임시) 후에 Cloudflare 연결할 것, js 정보 포함
import http from "node:http";
import {DatabaseSync} from "node:sqlite";
import {createHash, randomBytes, randomUUID, scrypt, timingSafeEqual} from "node:crypto";
import {promisify} from "node:util";
import {readFile} from "node:fs/promises";
import {mkdirSync} from "node:fs";
import {fileURLToPath} from "node:url";
import path from "node:path";
import "./questions.js";
import "./rules.js";

const root = fileURLToPath(new URL(".", import.meta.url));
const folder = process.env.GEEZ_DATA_DIR || path.join(root, "..", "data");
mkdirSync(folder, {recursive: true});
const db = new DatabaseSync(path.join(folder, "geez.sqlite"));
db.exec("PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL;");
// 던전 공유와 풀이 기록은 계정에 연결한다. 한 초안은 계정당 한 번만 등록할 수 있다.
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    login TEXT UNIQUE NOT NULL,
    nickname TEXT UNIQUE COLLATE NOCASE NOT NULL,
    salt TEXT NOT NULL,
    hash TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    user TEXT NOT NULL REFERENCES users,
    expires INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS packs (
    id TEXT PRIMARY KEY,
    owner TEXT NOT NULL REFERENCES users,
    draft TEXT NOT NULL,
    content TEXT NOT NULL,
    UNIQUE (owner, draft)
  );

  CREATE TABLE IF NOT EXISTS rounds (
    id TEXT PRIMARY KEY,
    user TEXT NOT NULL REFERENCES users,
    item TEXT NOT NULL,
    deadline INTEGER NOT NULL,
    finish INTEGER,
    correct INTEGER,
    expired INTEGER
  );

  CREATE INDEX IF NOT EXISTS round_history ON rounds (user, finish);
`);

const derive = promisify(scrypt);
const digest = v => createHash("sha256").update(v).digest("hex");
function fail(message, status = 400) {
  throw Object.assign(new Error(message), {status});
}

const sessionLifetimeSeconds = 7 * 24 * 60 * 60;
const tries = new Map();
function checkRate(key, limit) {
  const now = Date.now();
  for (const [entryKey, window] of tries) {
    if (window.end <= now) {
      tries.delete(entryKey);
    }
  }
  const window = tries.get(key) || {count: 0, end: now + 60000};
  if (++window.count > limit) {
    fail("잠시 후 다시 시도해 주세요.", 429);
  }
  tries.set(key, window);
}

function tokenOf(req) {
  return req.headers.cookie?.match(/(?:^|;\s*)geez_session=([a-f0-9]{64})(?:;|$)/)?.[1] || "";
}

function account(req) {
  return db.prepare(`
      SELECT u.id, u.nickname
      FROM users u JOIN sessions s ON u.id = s.user
      WHERE s.token = ? AND s.expires > ?
    `).get(digest(tokenOf(req)), Date.now()) || null;
}

// 쿠키에는 원본 토큰을 보내고, DB에는 조회용 해시만 저장한다.
function issueSession(req, res, user) {
  const token = randomBytes(32).toString("hex");
  db.prepare("DELETE FROM sessions WHERE expires<=? OR token=?")
      .run(Date.now(), digest(tokenOf(req)));
  db.prepare("INSERT INTO sessions VALUES(?,?,?)")
      .run(digest(token), user, Date.now() + sessionLifetimeSeconds * 1000);
  res.setHeader(
      "Set-Cookie",
      "geez_session=" + token +
          "; HttpOnly; SameSite=Strict; Path=/; Max-Age=" + sessionLifetimeSeconds);
}

async function authenticate(mode, credentials, req, res) {
  checkRate(req.socket.remoteAddress, 40);
  const login = String(credentials.login || "").normalize("NFKC").trim().toLowerCase();
  if (!/^[a-z0-9_]{4,24}$/.test(login) || typeof credentials.password !== "string" || !credentials.password ||
      credentials.password.length > 128) {
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
    const hash = (await derive(credentials.password, salt, 32)).toString("hex");
    const insert = db.prepare("INSERT OR IGNORE INTO users VALUES(?,?,?,?,?)")
                       .run(id, login, nickname, salt, hash);
    if (!insert.changes) {
      fail("이미 사용 중인 아이디 또는 닉네임이에요.", 409);
    }
    user = id;
  } else {
    const row = db.prepare("SELECT * FROM users WHERE login=?").get(login);
    const test = await derive(credentials.password, row?.salt || "00000000000000000000000000000000", 32);
    if (!row || !timingSafeEqual(test, Buffer.from(row.hash, "hex"))) {
      fail("아이디 또는 비밀번호를 확인해 주세요.", 401);
    }
    user = row.id;
  }
  issueSession(req, res, user);
  return {ok: true};
}

function state(user) {
  const shared = db.prepare(`
    SELECT p.id, p.content, u.nickname
    FROM packs p JOIN users u ON u.id = p.owner
    ORDER BY p.rowid DESC
  `).all().map(row => ({
    id: row.id,
    author: row.nickname,
    pack: JSON.parse(row.content)
  }));

  // 게스트도 공용 목록을 볼 수 있다. 풀이 기록은 로그인한 회원에게만 돌려준다.
  let attempts = [];
  if (user) {
    attempts = db.prepare(`
      SELECT item, correct, finish FROM rounds
      WHERE user = ? AND finish IS NOT NULL
      ORDER BY finish, rowid
    `).all(user.id).map(row => ({
      item: JSON.parse(row.item),
      correct: Boolean(row.correct),
      at: row.finish
    }));
  }
  return {service: "geez", user, shared, attempts};
}

async function operation(route, data, req, res) {
  const user = account(req);
  if (route === "state") {
    return state(user);
  }
  if (route === "signup" || route === "login") {
    return authenticate(route, data, req, res);
  }
  if (!user) {
    fail("로그인이 필요해요.", 401);
  }

  if (route === "logout") {
    db.prepare("DELETE FROM sessions WHERE token=?").run(digest(tokenOf(req)));
    res.setHeader("Set-Cookie", "geez_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0");
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
    db.prepare(`
      INSERT INTO packs VALUES (?, ?, ?, ?)
      ON CONFLICT(owner, draft) DO NOTHING
    `).run(randomUUID(), user.id, data.draftId, JSON.stringify(pack));
    return db.prepare("SELECT id FROM packs WHERE owner=? AND draft=?").get(user.id, data.draftId);
  }

  if (route === "start") {
    if (typeof data.id !== "string" || !Number.isInteger(data.index)) {
      fail("문제를 다시 선택해 주세요.");
    }
    // 도전 시작 시 문항과 마감 시각을 보관해 제출 때 같은 조건으로 채점한다.
    let pack = GEEZ.catalog.find(e => e.id === data.id)?.pack;
    if (!pack) {
      const row = db.prepare("SELECT content FROM packs WHERE id=?").get(data.id);
      if (row) {
        pack = JSON.parse(row.content);
      }
    }
    const item = pack?.items[data.index];
    if (!item) {
      fail("등록한 문제를 찾을 수 없어요.", 404);
    }
    const rid = randomUUID();
    const deadline = item.seconds ? Date.now() + item.seconds * 1000 : 0;
    db.prepare("INSERT INTO rounds(id,user,item,deadline) VALUES(?,?,?,?)")
        .run(rid, user.id, JSON.stringify(item), deadline);
    return {rid, deadline};
  }

  if (route === "answer") {
    if (typeof data.rid !== "string" || typeof data.answer !== "string" || data.answer.length > 100) {
      fail("답안을 확인해 주세요.");
    }
    const row = db.prepare("SELECT * FROM rounds WHERE id=? AND user=?").get(data.rid, user.id);
    if (!row) {
      fail("도전을 찾을 수 없어요.", 404);
    }
    // 답안을 다시 전송하면 처음 저장한 결과를 돌려준다.
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
    db.prepare(`
      UPDATE rounds SET finish = ?, correct = ?, expired = ?
      WHERE id = ? AND finish IS NULL
    `).run(now, Number(correct), Number(expired), data.rid);
    return {correct, expired};
  }
  fail("없는 요청이에요.", 404);
}

// 공개 목록에 있는 화면 파일과 이미지만 HTTP로 제공한다.
const publicFiles = [
  "index.html", "app.js", "workshop.js", "rules.js", "questions.js", "style.css",
  "art/badge.svg", "art/dungeon.webp",
  ...Array.from({length: 9}, (_, index) => `art/m${index}.webp`)
];
const staticFiles = new Map(publicFiles.map(file => ["/" + file, file]));
staticFiles.set("/", "index.html");

const mime = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".webp": "image/webp"
};

export async function handleRequest(req, res) {
  try {
    if (!/^(localhost|127\.0\.0\.1)(:\d+)?$/i.test(req.headers.host || "")) {
      fail("로컬 주소만 허용해요.", 403);
    }
    const base = "http://" + req.headers.host;
    const url = new URL(req.url, base);
    res.setHeader("X-Content-Type-Options", "nosniff");
    if (!url.pathname.startsWith("/api/")) {
      const file = staticFiles.get(url.pathname);
      if (!file || req.method !== "GET") {
        fail("없는 페이지예요.", 404);
      }
      res.setHeader("Content-Type", mime[path.extname(file)]);
      res.end(await readFile(path.join(root, file)));
      return;
    }
    const route = url.pathname.slice(5);
    if (req.method !== (route === "state" ? "GET" : "POST")) {
      fail("허용하지 않는 요청이에요.", 405);
    }
    let data = {};
    if (req.method === "POST") {
      if (req.headers.origin && req.headers.origin !== base) {
        fail("허용되지 않은 요청이에요.", 403);
      }
      if (req.headers["content-type"]?.split(";")[0] !== "application/json") {
        fail("JSON 요청이 필요해요.", 415);
      }
      const chunks = [];
      let bytes = 0;
      for await (const chunk of req) {
        bytes += chunk.length;
        if (bytes > 256 * 1024) {
          fail("파일이 너무 커요.", 413);
        }
        chunks.push(chunk);
      }
      try {
        data = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      } catch {
        fail("JSON을 확인해 주세요.");
      }
      if (!data || Array.isArray(data) || typeof data !== "object") {
        fail("요청 형식을 확인해 주세요.");
      }
    }
    const result = await operation(route, data, req, res);
    res.writeHead(
        200,
        {"Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store"});
    res.end(JSON.stringify(result));
  } catch (err) {
    res.writeHead(
        err.status || 500,
        {"Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store"});
    res.end(
        JSON.stringify({error: err.status ? err.message : "서버 처리 오류가 발생했어요."}));
    if (!err.status) {
      console.error(err);
    }
  }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const server = http.createServer(handleRequest);
  server.on("error", err => {
    console.error(
        err.code === "EADDRINUSE" ? "포트가 사용 중이에요. 다른 PORT 값을 지정해 주세요." :
                                    err.message);
    process.exitCode = 1;
    db.close();
  });
  server.listen(
      Number(process.env.PORT || 3000), "127.0.0.1",
      () => console.log("GEEZ  http://127.0.0.1:" + server.address().port));
}
