export const SCHEMA = `
CREATE TABLE IF NOT EXISTS trades (
  id TEXT PRIMARY KEY,
  symbol TEXT NOT NULL,
  price_cents INTEGER NOT NULL,
  quantity INTEGER NOT NULL,
  buy_order_id TEXT NOT NULL,
  sell_order_id TEXT NOT NULL,
  buy_user_id TEXT NOT NULL,
  sell_user_id TEXT NOT NULL,
  taker_side TEXT NOT NULL,
  sequence BIGINT NOT NULL,
  executed_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS trades_symbol_sequence
  ON trades (symbol, sequence DESC);

CREATE INDEX IF NOT EXISTS trades_symbol_time
  ON trades (symbol, executed_at);

CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  symbol TEXT NOT NULL,
  side TEXT NOT NULL,
  type TEXT NOT NULL,
  price_cents INTEGER,
  quantity INTEGER NOT NULL,
  remaining_quantity INTEGER NOT NULL,
  status TEXT NOT NULL,
  sequence BIGINT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS orders_user_created
  ON orders (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS orders_user_sequence
  ON orders (user_id, sequence DESC);

CREATE TABLE IF NOT EXISTS persistence_state (
  key TEXT PRIMARY KEY,
  value BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  display_name TEXT,
  role TEXT NOT NULL DEFAULT 'attendee',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS login_codes (
  email TEXT PRIMARY KEY,
  code_hash TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  requested_at TIMESTAMPTZ NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS sessions_user ON sessions (user_id);
`;