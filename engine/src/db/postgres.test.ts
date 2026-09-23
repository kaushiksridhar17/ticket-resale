import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { connectDatabase, type Database } from "./database.js";
import { PostgresSink, readLastLogSeq } from "./postgresSink.js";
import { orderHistory, tradeHistory } from "./queries.js";
import { PersistenceWriter, type PersistenceBatch } from "./writer.js";
import { ExchangeState } from "../exchangeState.js";
import { DEMO_EVENT_ID, DEMO_SYMBOL, DEMO_TIER_ID, demoEvent, seedEvent } from "../testEvent.js";
import type { Order, Side, Trade } from "../types.js";

const url = process.env.TEST_DATABASE_URL;

function fullBatch(
  partial: Partial<PersistenceBatch> & { lastLogSeq: number }
): PersistenceBatch {
  return {
    trades: [],
    orders: [],
    events: [],
    tickets: [],
    transfers: [],
    ...partial,
  };
}
const BASE_MS = Date.UTC(2026, 0, 1);

function trade(sequence: number, overrides: Partial<Trade> = {}): Trade {
  return {
    id: `trd_${sequence}`,
    symbol: "ACME",
    priceInCents: 5000,
    quantity: 10,
    buyOrderId: `ord_b${sequence}`,
    sellOrderId: `ord_s${sequence}`,
    buyUserId: "alice",
    sellUserId: "bob",
    takerSide: "buy",
    sequence,
    executedAt: BASE_MS + sequence * 1000,
    ...overrides,
  };
}

function order(id: string, overrides: Partial<Order> = {}): Order {
  return {
    id,
    userId: "alice",
    symbol: "ACME",
    side: "buy",
    type: "limit",
    priceInCents: 5000,
    quantity: 10,
    remainingQuantity: 10,
    status: "open",
    sequence: 1,
    createdAt: BASE_MS,
    ...overrides,
  };
}

describe.skipIf(!url)("postgres integration", () => {
  let db: Database;

  beforeAll(async () => {
    db = await connectDatabase(url!);
  });

  afterAll(async () => {
    await db?.end();
  });

  beforeEach(async () => {
    await db.query(
      "TRUNCATE trades, orders, persistence_state, ticket_transfers, tickets, event_tiers, events"
    );
  });

  async function count(table: string): Promise<number> {
    const result = await db.query<{ count: string }>(
      `SELECT count(*) FROM ${table}`
    );
    return Number(result.rows[0]!.count);
  }

  it("writes trades, orders and the log position together", async () => {
    const sink = new PostgresSink(db);

    await sink.write(fullBatch({
      trades: [trade(1), trade(2)],
      orders: [order("ord_1")],
      lastLogSeq: 7,
    }));

    expect(await count("trades")).toBe(2);
    expect(await count("orders")).toBe(1);
    expect(await readLastLogSeq(db)).toBe(7);
  });

  it("ignores a trade written twice", async () => {
    const sink = new PostgresSink(db);
    const written = fullBatch({ trades: [trade(1)], lastLogSeq: 1 });

    await sink.write(written);
    await sink.write(written);

    expect(await count("trades")).toBe(1);
  });

  it("updates an order with a later snapshot", async () => {
    const sink = new PostgresSink(db);

    await sink.write(fullBatch({ trades: [], orders: [order("ord_1")], lastLogSeq: 1 }));
    await sink.write(fullBatch({
      trades: [],
      orders: [order("ord_1", { remainingQuantity: 4, status: "partially_filled" })],
      lastLogSeq: 2,
    }));

    const history = await orderHistory(db, "alice", 10, null);
    expect(history).toHaveLength(1);
    expect(history[0]?.remainingQuantity).toBe(4);
    expect(history[0]?.status).toBe("partially_filled");
  });

  it("never moves the log position backwards", async () => {
    const sink = new PostgresSink(db);

    await sink.write(fullBatch({ trades: [trade(1)], orders: [], lastLogSeq: 10 }));
    await sink.write(fullBatch({ trades: [trade(2)], orders: [], lastLogSeq: 4 }));

    expect(await readLastLogSeq(db)).toBe(10);
  });

  it("rolls back the whole batch when part of it fails", async () => {
    const sink = new PostgresSink(db);
    const broken = trade(2, { priceInCents: null as unknown as number });

    await expect(
      sink.write(fullBatch({
        trades: [trade(1), broken],
        orders: [order("ord_1")],
        lastLogSeq: 9,
      }))
    ).rejects.toThrow();

    expect(await count("trades")).toBe(0);
    expect(await count("orders")).toBe(0);
    expect(await readLastLogSeq(db)).toBe(0);
  });

  it("pages through trade history without overlap", async () => {
    const sink = new PostgresSink(db);
    const trades = Array.from({ length: 10 }, (_, i) => trade(i + 1));
    await sink.write(fullBatch({
      trades: [...trades, trade(99, { symbol: "ZENX" })],
      orders: [],
      lastLogSeq: 1,
    }));

    const first = await tradeHistory(db, "ACME", 4, null);
    const second = await tradeHistory(db, "ACME", 4, first[3]!.sequence);
    const third = await tradeHistory(db, "ACME", 4, second[3]!.sequence);

    expect(first.map((t) => t.sequence)).toEqual([10, 9, 8, 7]);
    expect(second.map((t) => t.sequence)).toEqual([6, 5, 4, 3]);
    expect(third.map((t) => t.sequence)).toEqual([2, 1]);
    expect([...first, ...second, ...third].every((t) => t.symbol === "ACME")).toBe(
      true
    );
  });

  it("returns only the requested user's orders, newest first", async () => {
    const sink = new PostgresSink(db);
    await sink.write(fullBatch({
      trades: [],
      orders: [
        order("ord_1", { sequence: 1 }),
        order("ord_2", { sequence: 2, userId: "bob" }),
        order("ord_3", { sequence: 3 }),
      ],
      lastLogSeq: 1,
    }));

    const history = await orderHistory(db, "alice", 10, null);

    expect(history.map((o) => o.id)).toEqual(["ord_3", "ord_1"]);
  });

  it("writes an event with its tiers", async () => {
    const sink = new PostgresSink(db);

    await sink.write(fullBatch({ events: [demoEvent()], lastLogSeq: 1 }));

    expect(await count("events")).toBe(1);
    expect(await count("event_tiers")).toBe(1);

    const rows = await db.query<{ status: string; name: string }>(
      "SELECT status, name FROM events WHERE id = $1",
      [DEMO_EVENT_ID]
    );
    expect(rows.rows[0]?.status).toBe("on_sale");
    expect(rows.rows[0]?.name).toBe("Demo night");
  });

  it("updates an event's status in place", async () => {
    const sink = new PostgresSink(db);

    await sink.write(fullBatch({ events: [demoEvent()], lastLogSeq: 1 }));
    await sink.write(
      fullBatch({
        events: [{ ...demoEvent(), status: "cancelled" }],
        lastLogSeq: 2,
      })
    );

    const rows = await db.query<{ status: string }>(
      "SELECT status FROM events WHERE id = $1",
      [DEMO_EVENT_ID]
    );
    expect(await count("events")).toBe(1);
    expect(rows.rows[0]?.status).toBe("cancelled");
  });

  it("moves a ticket to its new holder but never backwards", async () => {
    const sink = new PostgresSink(db);
    const ticket = {
      id: "tkt_1",
      symbol: DEMO_SYMBOL,
      serial: 1,
      holderId: "alice",
      rotation: 0,
    };

    await sink.write(fullBatch({ tickets: [ticket], lastLogSeq: 1 }));
    await sink.write(
      fullBatch({
        tickets: [{ ...ticket, holderId: "bob", rotation: 1 }],
        lastLogSeq: 2,
      })
    );
    await sink.write(
      fullBatch({
        tickets: [{ ...ticket, holderId: "alice", rotation: 0 }],
        lastLogSeq: 3,
      })
    );

    const rows = await db.query<{ holder_id: string; rotation: number }>(
      "SELECT holder_id, rotation FROM tickets WHERE id = $1",
      ["tkt_1"]
    );
    expect(rows.rows[0]?.holder_id).toBe("bob");
    expect(rows.rows[0]?.rotation).toBe(1);
  });

  it("keeps every hand-over exactly once", async () => {
    const sink = new PostgresSink(db);
    const transfer = {
      ticketId: "tkt_1",
      rotation: 1,
      symbol: DEMO_SYMBOL,
      fromUserId: "alice",
      toUserId: "bob",
      tradeId: "trd_1",
    };

    await sink.write(fullBatch({ transfers: [transfer], lastLogSeq: 1 }));
    await sink.write(fullBatch({ transfers: [transfer], lastLogSeq: 2 }));
    await sink.write(
      fullBatch({
        transfers: [{ ...transfer, rotation: 2, fromUserId: "bob", toUserId: "carol" }],
        lastLogSeq: 3,
      })
    );

    const rows = await db.query<{ to_user_id: string }>(
      "SELECT to_user_id FROM ticket_transfers WHERE ticket_id = $1 ORDER BY rotation",
      ["tkt_1"]
    );
    expect(rows.rows.map((row) => row.to_user_id)).toEqual(["bob", "carol"]);
  });

  it("rebuilds the ticket tables from the log alone", async () => {
    const dir = mkdtempSync(join(tmpdir(), "exchange-pg-rebuild-"));
    const logPath = join(dir, "events.jsonl");

    try {
      const first = new ExchangeState(logPath);
      first.createEvent(demoEvent());
      first.issueTickets(DEMO_EVENT_ID, DEMO_TIER_ID, 4, "alice");
      first.ensureAccount("bob");
      const sell = {
        id: first.nextOrderId(),
        userId: "alice",
        symbol: DEMO_SYMBOL,
        side: "sell" as Side,
        type: "limit" as const,
        priceInCents: 5000,
        quantity: 2,
        remainingQuantity: 2,
        status: "open" as const,
        sequence: 0,
        createdAt: BASE_MS,
      };
      first.submitOrder(sell);
      first.submitOrder({ ...sell, id: first.nextOrderId(), userId: "bob", side: "buy" });
      first.close();

      const writer = new PersistenceWriter(new PostgresSink(db));
      const replayed = new ExchangeState(logPath, {
        persistence: writer,
        lastPersistedLogSeq: 0,
      });
      await writer.drain();
      replayed.close();

      const holders = await db.query<{ holder_id: string; count: string }>(
        "SELECT holder_id, count(*) FROM tickets GROUP BY holder_id ORDER BY holder_id"
      );
      expect(holders.rows).toEqual([
        { holder_id: "alice", count: "2" },
        { holder_id: "bob", count: "2" },
      ]);
      expect(await count("ticket_transfers")).toBe(6);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("keeps the database in step with the exchange end to end", async () => {
    const dir = mkdtempSync(join(tmpdir(), "exchange-pg-"));
    const logPath = join(dir, "events.jsonl");

    try {
      const writer = new PersistenceWriter(new PostgresSink(db), {
        onError: () => undefined,
      });
      const state = new ExchangeState(logPath, { persistence: writer });
      seedEvent(state, { issueTo: ["alice", "bob", "carol"], count: 1000 });

      const place = (userId: string, side: Side, quantity: number): Order => {
        state.ensureAccount(userId);
        return state.submitOrder({
          id: state.nextOrderId(),
          userId,
          symbol: DEMO_SYMBOL,
          side,
          type: "limit",
          priceInCents: 5000,
          quantity,
          remainingQuantity: quantity,
          status: "open",
          sequence: 0,
          createdAt: BASE_MS,
        }).order;
      };

      const resting = place("alice", "sell", 100);
      place("bob", "buy", 40);
      place("carol", "buy", 30);
      state.cancelOrder(DEMO_SYMBOL, resting.id);

      await writer.drain();

      expect(await count("trades")).toBe(2);
      expect(await count("orders")).toBe(3);
      expect(await count("events")).toBe(1);
      expect(await count("tickets")).toBe(3000);
      expect(await count("ticket_transfers")).toBe(3070);
      expect(await readLastLogSeq(db)).toBe(state.logPosition());

      const alice = await orderHistory(db, "alice", 10, null);
      expect(alice[0]?.status).toBe("cancelled");
      expect(alice[0]?.remainingQuantity).toBe(30);

      state.close();

      const restarted = new ExchangeState(logPath, {
        persistence: new PersistenceWriter(new PostgresSink(db)),
        lastPersistedLogSeq: await readLastLogSeq(db),
      });
      expect(restarted.requeuedForDatabase).toBe(0);
      restarted.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});