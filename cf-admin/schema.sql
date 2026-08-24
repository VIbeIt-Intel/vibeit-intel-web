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
  cursor_url TEXT
);

CREATE INDEX IF NOT EXISTS briefs_created_at ON briefs (created_at DESC);
CREATE INDEX IF NOT EXISTS briefs_status ON briefs (status);