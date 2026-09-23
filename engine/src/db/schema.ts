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
`;