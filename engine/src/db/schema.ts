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

CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  organizer_id TEXT NOT NULL,
  name TEXT NOT NULL,
  venue TEXT NOT NULL,
  starts_at TIMESTAMPTZ NOT NULL,
  sales_close_at TIMESTAMPTZ NOT NULL,
  payment_mode TEXT NOT NULL,
  status TEXT NOT NULL,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS events_organizer ON events (organizer_id);

CREATE TABLE IF NOT EXISTS event_tiers (
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  tier_id TEXT NOT NULL,
  name TEXT NOT NULL,
  face_value_cents INTEGER NOT NULL,
  per_person_limit INTEGER NOT NULL,
  PRIMARY KEY (event_id, tier_id)
);

CREATE TABLE IF NOT EXISTS tickets (
  id TEXT PRIMARY KEY,
  symbol TEXT NOT NULL,
  serial INTEGER NOT NULL,
  holder_id TEXT NOT NULL,
  rotation INTEGER NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS tickets_symbol_serial
  ON tickets (symbol, serial);

CREATE INDEX IF NOT EXISTS tickets_holder ON tickets (holder_id, symbol);

CREATE TABLE IF NOT EXISTS ticket_transfers (
  ticket_id TEXT NOT NULL,
  rotation INTEGER NOT NULL,
  symbol TEXT NOT NULL,
  from_user_id TEXT,
  to_user_id TEXT NOT NULL,
  trade_id TEXT,
  PRIMARY KEY (ticket_id, rotation)
);

CREATE INDEX IF NOT EXISTS ticket_transfers_holder
  ON ticket_transfers (to_user_id);

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
