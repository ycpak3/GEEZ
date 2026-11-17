import {readFileSync, readdirSync} from "node:fs";

const migrations = new URL("./migrations/", import.meta.url);

// 기존 로컬 DB의 회원·세션·공개 작품·풀이 기록을 공통 테이블 이름으로 이전
function upgradeLegacyNames(db) {
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all();
  const existing = new Set(tables.map(row => row.name));
  for (const name of ["users", "sessions", "packs", "rounds"]) {
    if (existing.has(name)) db.exec(`ALTER TABLE ${name} RENAME TO geez_${name}`);
  }
}

// 처리된 SQL 파일명을 기록해 재시작 때 사용자 데이터나 기본 문항을 덮어쓰지 않도록 처리
export function migrateLocal(db) {
  db.exec("PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000; BEGIN IMMEDIATE");
  try {
    db.exec(`CREATE TABLE IF NOT EXISTS geez_schema_migrations (
      id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE,
      applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`);
    const applied = new Set(db.prepare("SELECT name FROM geez_schema_migrations").all().map(row => row.name));
    if (!applied.has("0001_geez.sql")) upgradeLegacyNames(db);
    const remember = db.prepare("INSERT INTO geez_schema_migrations(name) VALUES (?)");
    for (const name of readdirSync(migrations).filter(file => file.endsWith(".sql")).sort()) {
      if (applied.has(name)) continue;
      db.exec(readFileSync(new URL(name, migrations), "utf8"));
      remember.run(name);
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
