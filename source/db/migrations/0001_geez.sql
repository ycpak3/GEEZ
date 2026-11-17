CREATE TABLE IF NOT EXISTS geez_users (
  id TEXT PRIMARY KEY,
  login TEXT UNIQUE NOT NULL,
  nickname TEXT UNIQUE COLLATE NOCASE NOT NULL,
  salt TEXT NOT NULL,
  hash TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS geez_sessions (
  token TEXT PRIMARY KEY,
  user TEXT NOT NULL REFERENCES geez_users,
  expires INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS geez_packs (
  id TEXT PRIMARY KEY,
  owner TEXT NOT NULL REFERENCES geez_users,
  draft TEXT NOT NULL,
  content TEXT NOT NULL,
  UNIQUE (owner, draft)
);

CREATE TABLE IF NOT EXISTS geez_rounds (
  id TEXT PRIMARY KEY,
  user TEXT NOT NULL REFERENCES geez_users,
  item TEXT NOT NULL,
  deadline INTEGER NOT NULL,
  finish INTEGER,
  correct INTEGER,
  expired INTEGER
);

CREATE INDEX IF NOT EXISTS geez_round_history ON geez_rounds (user, finish);
