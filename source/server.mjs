// 선택 실행: node source/server.mjs  (Node.js 22.13 이상)
import {publicFiles} from "./public-files.mjs";
import http from "node:http";
import {DatabaseSync} from "node:sqlite";
import {scrypt} from "node:crypto";
import {promisify} from "node:util";
import {readFile} from "node:fs/promises";
import {mkdirSync} from "node:fs";
import {fileURLToPath} from "node:url";
import path from "node:path";
import {createApi, fail} from "./api.mjs";
import {migrateLocal} from "./db/local.mjs";
import {localSearch} from "./search/local.mjs";

const root = fileURLToPath(new URL(".", import.meta.url));
const folder = process.env.GEEZ_DATA_DIR || path.join(root, "..", "data");
mkdirSync(folder, {recursive: true});
const db = new DatabaseSync(path.join(folder, "geez.sqlite"));
db.exec("PRAGMA journal_mode = WAL");
migrateLocal(db);

const derive = promisify(scrypt);
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

const operation = createApi({
  db: {
    first: (sql, ...params) => db.prepare(sql).get(...params),
    all: (sql, ...params) => db.prepare(sql).all(...params),
    run: (sql, ...params) => db.prepare(sql).run(...params).changes,
    batch(statements, id) {
      db.exec("BEGIN IMMEDIATE");
      try {
        for (const sql of statements) db.prepare(sql).run(id);
        db.exec("COMMIT");
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    }
  },
  hashPassword: (password, salt) => derive(password, salt, 32),
  limitAuth: req => checkRate(req.address, 40),
  search: localSearch
});

// 공개 목록의 화면 파일과 이미지만 HTTP로 제공
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
    if (req.method !== (["catalog", "state", "community"].includes(route) ? "GET" : "POST")) {
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
    const headers = new Headers();
    const result = await operation(
        route, data, {cookie: req.headers.cookie, address: req.socket.remoteAddress, secure: false},
        headers);
    for (const [name, value] of headers) res.setHeader(name, value);
    res.writeHead(200, {"Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store"});
    res.end(JSON.stringify(result));
  } catch (err) {
    res.writeHead(
        err.status || 500,
        {"Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store"});
    res.end(JSON.stringify({error: err.status ? err.message : "서버 처리 오류가 발생했어요."}));
    if (!err.status) {
      console.error(err);
    }
  }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const server = http.createServer(handleRequest);
  server.on("error", err => {
    console.error(
        err.code === "EADDRINUSE" ? "포트가 사용 중이에요. 다른 PORT 값을 지정해 주세요." : err.message);
    process.exitCode = 1;
    db.close();
  });
  server.listen(
      Number(process.env.PORT || 3000), "127.0.0.1",
      () => console.log("GEEZ  http://127.0.0.1:" + server.address().port));
}
