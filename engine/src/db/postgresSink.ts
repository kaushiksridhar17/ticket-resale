import type { Database } from "./database.js";
import type { PersistenceBatch, PersistenceSink } from "./writer.js";
import type { Order, Trade } from "../types.js";

const TRADE_COLUMNS = [
  "id",
  "symbol",
  "price_cents",
  "quantity",
  "buy_order_id",
  "sell_order_id",
  "buy_user_id",
  "sell_user_id",
  "taker_side",
  "sequence",
  "executed_at",
];

const ORDER_COLUMNS = [
  "id",
  "user_id",
  "symbol",
  "side",
  "type",
  "price_cents",
  "quantity",
  "remaining_quantity",
  "status",
  "sequence",
  "created_at",
];

export class PostgresSink implements PersistenceSink {
  constructor(private readonly db: Database) {}

  async write(batch: PersistenceBatch): Promise<void> {
    const client = await this.db.connect();
    try {
      await client.query("BEGIN");

      if (batch.trades.length > 0) {
        await client.query(tradeInsert(batch.trades));
      }
      if (batch.orders.length > 0) {
        await client.query(orderUpsert(batch.orders));
      }

      await client.query(
        `INSERT INTO persistence_state (key, value)
         VALUES ('last_log_seq', $1)
         ON CONFLICT (key)
         DO UPDATE SET value = GREATEST(persistence_state.value, EXCLUDED.value)`,
        [batch.lastLogSeq]
      );

      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }
}

export async function readLastLogSeq(db: Database): Promise<number> {
  const result = await db.query<{ value: string }>(
    "SELECT value FROM persistence_state WHERE key = 'last_log_seq'"
  );
  const row = result.rows[0];
  return row ? Number(row.value) : 0;
}

function placeholders(rowCount: number, columnCount: number): string {
  const rows: string[] = [];
  for (let row = 0; row < rowCount; row += 1) {
    const cells: string[] = [];
    for (let column = 0; column < columnCount; column += 1) {
      cells.push(`$${row * columnCount + column + 1}`);
    }
    rows.push(`(${cells.join(", ")})`);
  }
  return rows.join(", ");
}

function tradeInsert(trades: Trade[]) {
  const values = trades.flatMap((trade) => [
    trade.id,
    trade.symbol,
    trade.priceInCents,
    trade.quantity,
    trade.buyOrderId,
    trade.sellOrderId,
    trade.buyUserId,
    trade.sellUserId,
    trade.takerSide,
    trade.sequence,
    new Date(trade.executedAt),
  ]);

  return {
    text: `INSERT INTO trades (${TRADE_COLUMNS.join(", ")})
           VALUES ${placeholders(trades.length, TRADE_COLUMNS.length)}
           ON CONFLICT (id) DO NOTHING`,
    values,
  };
}

function orderUpsert(orders: Order[]) {
  const values = orders.flatMap((order) => [
    order.id,
    order.userId,
    order.symbol,
    order.side,
    order.type,
    order.priceInCents,
    order.quantity,
    order.remainingQuantity,
    order.status,
    order.sequence,
    new Date(order.createdAt),
  ]);

  return {
    text: `INSERT INTO orders (${ORDER_COLUMNS.join(", ")})
           VALUES ${placeholders(orders.length, ORDER_COLUMNS.length)}
           ON CONFLICT (id) DO UPDATE SET
             remaining_quantity = EXCLUDED.remaining_quantity,
             status = EXCLUDED.status,
             sequence = EXCLUDED.sequence,
             updated_at = now()`,
    values,
  };
}