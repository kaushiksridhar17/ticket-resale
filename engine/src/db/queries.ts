import type { Database } from "./database.js";
import type { Order, Side, OrderStatus, OrderType, Trade } from "../types.js";

export interface Candle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface TradeRow {
  id: string;
  symbol: string;
  price_cents: number;
  quantity: number;
  buy_order_id: string;
  sell_order_id: string;
  buy_user_id: string;
  sell_user_id: string;
  taker_side: Side;
  sequence: string;
  executed_at: Date;
}

interface OrderRow {
  id: string;
  user_id: string;
  symbol: string;
  side: Side;
  type: OrderType;
  price_cents: number | null;
  quantity: number;
  remaining_quantity: number;
  status: OrderStatus;
  sequence: string;
  created_at: Date;
}

interface CandleRow {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: string;
}

export async function tradeHistory(
  db: Database,
  symbol: string,
  limit: number,
  before: number | null
): Promise<Trade[]> {
  const result = await db.query<TradeRow>(
    `SELECT id, symbol, price_cents, quantity, buy_order_id, sell_order_id,
            buy_user_id, sell_user_id, taker_side, sequence, executed_at
       FROM trades
      WHERE symbol = $1
        AND ($2::bigint IS NULL OR sequence < $2::bigint)
      ORDER BY sequence DESC
      LIMIT $3`,
    [symbol, before, limit]
  );
  return result.rows.map(toTrade);
}

export async function orderHistory(
  db: Database,
  userId: string,
  limit: number,
  before: number | null
): Promise<Order[]> {
  const result = await db.query<OrderRow>(
    `SELECT id, user_id, symbol, side, type, price_cents, quantity,
            remaining_quantity, status, sequence, created_at
       FROM orders
      WHERE user_id = $1
        AND ($2::bigint IS NULL OR sequence < $2::bigint)
      ORDER BY sequence DESC
      LIMIT $3`,
    [userId, before, limit]
  );
  return result.rows.map(toOrder);
}

export async function candles(
  db: Database,
  symbol: string,
  intervalSeconds: number,
  limit: number
): Promise<Candle[]> {
  const result = await db.query<CandleRow>(
    `WITH latest AS (
       SELECT max(executed_at) AS at FROM trades WHERE symbol = $1
     ),
     binned AS (
       SELECT date_bin(
                make_interval(secs => $2::double precision),
                t.executed_at,
                TIMESTAMPTZ '2000-01-01 00:00:00+00'
              ) AS bucket,
              t.price_cents,
              t.quantity,
              t.sequence
         FROM trades t, latest
        WHERE t.symbol = $1
          AND t.executed_at > latest.at
              - make_interval(secs => $2::double precision * $3::integer)
     )
     SELECT extract(epoch FROM bucket)::bigint AS time,
            (array_agg(price_cents ORDER BY sequence))[1] AS open,
            max(price_cents) AS high,
            min(price_cents) AS low,
            (array_agg(price_cents ORDER BY sequence DESC))[1] AS close,
            sum(quantity) AS volume
       FROM binned
      GROUP BY bucket
      ORDER BY bucket`,
    [symbol, intervalSeconds, limit]
  );

  return result.rows.map((row) => ({
    time: Number(row.time),
    open: row.open,
    high: row.high,
    low: row.low,
    close: row.close,
    volume: Number(row.volume),
  }));
}

function toTrade(row: TradeRow): Trade {
  return {
    id: row.id,
    symbol: row.symbol,
    priceInCents: row.price_cents,
    quantity: row.quantity,
    buyOrderId: row.buy_order_id,
    sellOrderId: row.sell_order_id,
    buyUserId: row.buy_user_id,
    sellUserId: row.sell_user_id,
    takerSide: row.taker_side,
    sequence: Number(row.sequence),
    executedAt: row.executed_at.getTime(),
  };
}

function toOrder(row: OrderRow): Order {
  return {
    id: row.id,
    userId: row.user_id,
    symbol: row.symbol,
    side: row.side,
    type: row.type,
    priceInCents: row.price_cents,
    maxNotionalInCents: null,
    quantity: row.quantity,
    remainingQuantity: row.remaining_quantity,
    status: row.status,
    sequence: Number(row.sequence),
    createdAt: row.created_at.getTime(),
  };
}