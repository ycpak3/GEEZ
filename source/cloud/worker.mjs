import {Buffer} from "node:buffer";
import {createApi, fail} from "../api.mjs";

async function hashPassword(password, salt) {
  const encoder = new TextEncoder();
  const key =
      await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
      {name: "PBKDF2", hash: "SHA-256", salt: encoder.encode(salt), iterations: 100000}, key, 256);
  return Buffer.from(bits);
}

async function readData(request, origin) {
  if (request.headers.has("Origin") && request.headers.get("Origin") !== origin) {
    fail("허용되지 않은 출처예요.", 403);
  }
  if (request.headers.get("Content-Type")?.split(";")[0] !== "application/json") {
    fail("JSON 요청이 필요해요.", 415);
  }
  const limit = 256 * 1024;
  if (Number(request.headers.get("Content-Length")) > limit) fail("파일이 너무 커요.", 413);
  const reader = request.body?.getReader();
  if (!reader) fail("JSON을 확인해 주세요.");
  const chunks = [];
  let size = 0;
  while (true) {
    const {done, value} = await reader.read();
    if (done) break;
    size += value.length;
    if (size > limit) {
      await reader.cancel();
      fail("파일이 너무 커요.", 413);
    }
    chunks.push(value);
  }
  let data;
  try {
    data = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    fail("JSON을 확인해 주세요.");
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) fail("요청 형식을 확인해 주세요.");
  return data;
}

// 정적 파일과 API 요청을 분기하고 D1·검색 서비스 바인딩 연결
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith("/api/")) return env.ASSETS.fetch(request);
    const headers = new Headers({"Cache-Control": "no-store", "X-Content-Type-Options": "nosniff"});
    try {
      const route = url.pathname.slice(5);
      if (request.method !== (["catalog", "state", "community"].includes(route) ? "GET" : "POST"))
        fail("지원하지 않는 요청이에요.", 405);
      const data = request.method === "POST" ? await readData(request, url.origin) : {};
      const statement = (sql, params) => {
        const query = env.DB.prepare(sql);
        return params.length ? query.bind(...params) : query;
      };
      const operation = createApi({
        db: {
          first: (sql, ...params) => statement(sql, params).first(),
          all: async (sql, ...params) => (await statement(sql, params).all()).results,
          run: async (sql, ...params) => (await statement(sql, params).run()).meta.changes,
          batch: (statements, id) => env.DB.batch(statements.map(sql => statement(sql, [id])))
        },
        hashPassword,
        async limitAuth() {
          const key = request.headers.get("CF-Connecting-IP") || "local";
          if (!(await env.AUTH_LIMIT.limit({key})).success) fail("잠시 후 다시 시도해 주세요.", 429);
        },
        async search(payload) {
          const response = await env.SIMILARITY.fetch("https://search.internal/similar", {
            method: "POST",
            headers: {"Content-Type": "application/json"},
            body: JSON.stringify(payload)
          });
          if (!response.ok) fail("유사 문항 검색을 잠시 후 다시 시도해 주세요.", 503);
          return response.json();
        }
      });
      const result = await operation(
          route, data, {cookie: request.headers.get("Cookie"), secure: url.protocol === "https:"},
          headers);
      return Response.json(result, {headers});
    } catch (err) {
      if (!err.status) console.error(err.message);
      return Response.json(
          {error: err.status ? err.message : "서버 처리 오류가 발생했어요."},
          {status: err.status || 500, headers});
    }
  }
};
