CREATE TABLE IF NOT EXISTS briefs (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'new',
  package TEXT,
  business_name TEXT,
  email TEXT,
  phone TEXT,
  subject TEXT,
  brief_text TEXT,
  files TEXT NOT NULL DEFAULT '[]',
  github_repo TEXT,
  cursor_agent_id TEXT,
  cursor_url TEXT,
  preview_url TEXT,
  preview_status TEXT,
  build_error TEXT
);

CREATE INDEX IF NOT EXISTS briefs_created_at ON briefs (created_at DESC);
CREATE INDEX IF NOT EXISTS briefs_status ON briefs (status);

CREATE TABLE IF NOT EXISTS invoices (
  id TEXT PRIMARY KEY,
  brief_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  kind TEXT NOT NULL,
  number TEXT NOT NULL,
  amount INTEGER NOT NULL,
  description TEXT,
  note TEXT,
  to_email TEXT,
  sent_at TEXT,
  sent_via TEXT
);

CREATE INDEX IF NOT EXISTS invoices_brief ON invoices (brief_id, created_at DESC);