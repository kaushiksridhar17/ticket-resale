import type { Database } from "./database.js";
import type { PersistenceBatch, PersistenceSink } from "./writer.js";
import type { EventDefinition } from "../events/types.js";
import type { Ticket, TicketTransfer } from "../tickets/types.js";
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

const EVENT_COLUMNS = [
  "id",
  "organizer_id",
  "name",
  "venue",
  "starts_at",
  "sales_close_at",
  "payment_mode",
  "status",
];

const TIER_COLUMNS = [
  "event_id",
  "tier_id",
  "name",
  "face_value_cents",
  "per_person_limit",
];

const TICKET_COLUMNS = [
  "id",
  "symbol",
  "serial",
  "holder_id",
  "rotation",
  "admitted_at",
];

const TRANSFER_COLUMNS = [
  "ticket_id",
  "rotation",
  "symbol",
  "from_user_id",
  "to_user_id",
  "trade_id",
];

export class PostgresSink implements PersistenceSink {
  constructor(private readonly db: Database) {}

  async write(batch: PersistenceBatch): Promise<void> {
    const client = await this.db.connect();
    try {
      await client.query("BEGIN");

      if (batch.events.length > 0) {
        await client.query(eventUpsert(batch.events));
        const tiers = batch.events.flatMap((event) =>
          event.tiers.map((tier) => ({ eventId: event.id, tier }))
        );
        if (tiers.length > 0) {
          await client.query(tierUpsert(tiers));
        }
      }
      if (batch.trades.length > 0) {
        await client.query(tradeInsert(batch.trades));
      }
      if (batch.orders.length > 0) {
        await client.query(orderUpsert(batch.orders));
      }
      if (batch.tickets.length > 0) {
        await client.query(ticketUpsert(batch.tickets));
      }
      if (batch.transfers.length > 0) {
        await client.query(transferInsert(batch.transfers));
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

function eventUpsert(events: EventDefinition[]) {
  const values = events.flatMap((event) => [
    event.id,
    event.organizerId,
    event.name,
    event.venue,
    new Date(event.startsAt),
    new Date(event.salesCloseAt),
    event.paymentMode,
    event.status,
  ]);

  return {
    text: `INSERT INTO events (${EVENT_COLUMNS.join(", ")})
           VALUES ${placeholders(events.length, EVENT_COLUMNS.length)}
           ON CONFLICT (id) DO UPDATE SET
             name = EXCLUDED.name,
             venue = EXCLUDED.venue,
             starts_at = EXCLUDED.starts_at,
             sales_close_at = EXCLUDED.sales_close_at,
             payment_mode = EXCLUDED.payment_mode,
             status = EXCLUDED.status`,
    values,
  };
}

function tierUpsert(
  tiers: { eventId: string; tier: EventDefinition["tiers"][number] }[]
) {
  const values = tiers.flatMap(({ eventId, tier }) => [
    eventId,
    tier.tierId,
    tier.name,
    tier.faceValueInCents,
    tier.perPersonLimit,
  ]);

  return {
    text: `INSERT INTO event_tiers (${TIER_COLUMNS.join(", ")})
           VALUES ${placeholders(tiers.length, TIER_COLUMNS.length)}
           ON CONFLICT (event_id, tier_id) DO UPDATE SET
             name = EXCLUDED.name,
             face_value_cents = EXCLUDED.face_value_cents,
             per_person_limit = EXCLUDED.per_person_limit`,
    values,
  };
}

function ticketUpsert(tickets: Ticket[]) {
  const values = tickets.flatMap((ticket) => [
    ticket.id,
    ticket.symbol,
    ticket.serial,
    ticket.holderId,
    ticket.rotation,
    ticket.admittedAt === null ? null : new Date(ticket.admittedAt),
  ]);

  return {
    text: `INSERT INTO tickets (${TICKET_COLUMNS.join(", ")})
           VALUES ${placeholders(tickets.length, TICKET_COLUMNS.length)}
           ON CONFLICT (id) DO UPDATE SET
             holder_id = EXCLUDED.holder_id,
             rotation = EXCLUDED.rotation,
             admitted_at = COALESCE(EXCLUDED.admitted_at, tickets.admitted_at),
             updated_at = now()
           WHERE EXCLUDED.rotation >= tickets.rotation`,
    values,
  };
}

function transferInsert(transfers: TicketTransfer[]) {
  const values = transfers.flatMap((transfer) => [
    transfer.ticketId,
    transfer.rotation,
    transfer.symbol,
    transfer.fromUserId,
    transfer.toUserId,
    transfer.tradeId,
  ]);

  return {
    text: `INSERT INTO ticket_transfers (${TRANSFER_COLUMNS.join(", ")})
           VALUES ${placeholders(transfers.length, TRANSFER_COLUMNS.length)}
           ON CONFLICT (ticket_id, rotation) DO NOTHING`,
    values,
  };
}
