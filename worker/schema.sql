-- 旅費記帳：成員、登入、花費、分攤對象、設定
CREATE TABLE IF NOT EXISTS members (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  salt TEXT NOT NULL,
  pin_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'member',
  active INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  member_id TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS expenses (
  id TEXT PRIMARY KEY,
  date TEXT NOT NULL,
  title TEXT NOT NULL,
  category TEXT NOT NULL,
  currency TEXT NOT NULL,
  amount REAL NOT NULL,
  rate REAL NOT NULL,
  amount_twd REAL NOT NULL,
  payer_id TEXT NOT NULL,
  note TEXT,
  created_by TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS expense_shares (
  expense_id TEXT NOT NULL,
  member_id TEXT NOT NULL,
  PRIMARY KEY (expense_id, member_id)
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

INSERT OR IGNORE INTO settings (key, value) VALUES ('rate', '0.21');
INSERT OR IGNORE INTO settings (key, value) VALUES ('startDate', '2027-01-22');
INSERT OR IGNORE INTO settings (key, value) VALUES ('endDate', '2027-01-29');

CREATE INDEX IF NOT EXISTS idx_expenses_date ON expenses (date DESC);
CREATE INDEX IF NOT EXISTS idx_sessions_member ON sessions (member_id);
