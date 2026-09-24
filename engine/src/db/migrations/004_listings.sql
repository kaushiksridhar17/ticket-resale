CREATE TABLE IF NOT EXISTS listings (
  id TEXT PRIMARY KEY,
  seller_id TEXT NOT NULL,
  event_id TEXT NOT NULL,
  tier_id TEXT NOT NULL,
  quantity INTEGER NOT NULL,
  note TEXT,
  evidence TEXT NOT NULL,
  status TEXT NOT NULL,
  submitted_at TIMESTAMPTZ NOT NULL,
  decided_at TIMESTAMPTZ,
  decided_by TEXT,
  reason TEXT
);

CREATE INDEX IF NOT EXISTS listings_status ON listings (status, submitted_at DESC);
CREATE INDEX IF NOT EXISTS listings_seller ON listings (seller_id, submitted_at DESC);
