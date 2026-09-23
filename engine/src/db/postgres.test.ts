import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { connectDatabase, type Database } from "./database.js";
import { PostgresSink, readLastLogSeq } from "./postgresSink.js";
import { candles, orderHistory, tradeHistory } from "./queries.js";
import { PersistenceWriter } from "./writer.js";
import { ExchangeState } from "../exchangeState.js";
import type { Order, Side, Trade } from "../types.js";

const url = process.env.TEST_DATABASE_URL;
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
    maxNotionalInCents: null,
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
    await db.query("TRUNCATE trades, orders, persistence_state");
  });

  async function count(table: string): Promise<number> {
    const result = await db.query<{ count: string }>(
      `SELECT count(*) FROM ${table}`
    );
    return Number(result.rows[0]!.count);
  }

  it("writes trades, orders and the log position together", async () => {
    const sink = new PostgresSink(db);

    await sink.write({
      trades: [trade(1), trade(2)],
      orders: [order("ord_1")],
      lastLogSeq: 7,
    });

    expect(await count("trades")).toBe(2);
    expect(await count("orders")).toBe(1);
    expect(await readLastLogSeq(db)).toBe(7);
  });

  it("ignores a trade written twice", async () => {
    const sink = new PostgresSink(db);
    const batch = { trades: [trade(1)], orders: [], lastLogSeq: 1 };

    await sink.write(batch);
    await sink.write(batch);

    expect(await count("trades")).toBe(1);
  });

  it("updates an order with a later snapshot", async () => {
    const sink = new PostgresSink(db);

    await sink.write({ trades: [], orders: [order("ord_1")], lastLogSeq: 1 });
    await sink.write({
      trades: [],
      orders: [order("ord_1", { remainingQuantity: 4, status: "partially_filled" })],
      lastLogSeq: 2,
    });

    const history = await orderHistory(db, "alice", 10, null);
    expect(history).toHaveLength(1);
    expect(history[0]?.remainingQuantity).toBe(4);
    expect(history[0]?.status).toBe("partially_filled");
  });

  it("never moves the log position backwards", async () => {
    const sink = new PostgresSink(db);

    await sink.write({ trades: [trade(1)], orders: [], lastLogSeq: 10 });
    await sink.write({ trades: [trade(2)], orders: [], lastLogSeq: 4 });

    expect(await readLastLogSeq(db)).toBe(10);
  });

  it("rolls back the whole batch when part of it fails", async () => {
    const sink = new PostgresSink(db);
    const broken = trade(2, { priceInCents: null as unknown as number });

    await expect(
      sink.write({
        trades: [trade(1), broken],
        orders: [order("ord_1")],
        lastLogSeq: 9,
      })
    ).rejects.toThrow();

    expect(await count("trades")).toBe(0);
    expect(await count("orders")).toBe(0);
    expect(await readLastLogSeq(db)).toBe(0);
  });

  it("pages through trade history without overlap", async () => {
    const sink = new PostgresSink(db);
    const trades = Array.from({ length: 10 }, (_, i) => trade(i + 1));
    await sink.write({
      trades: [...trades, trade(99, { symbol: "ZENX" })],
      orders: [],
      lastLogSeq: 1,
    });

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
    await sink.write({
      trades: [],
      orders: [
        order("ord_1", { sequence: 1 }),
        order("ord_2", { sequence: 2, userId: "bob" }),
        order("ord_3", { sequence: 3 }),
      ],
      lastLogSeq: 1,
    });

    const history = await orderHistory(db, "alice", 10, null);

    expect(history.map((o) => o.id)).toEqual(["ord_3", "ord_1"]);
  });

  it("builds candles from trades, using sequence to break ties", async () => {
    const sink = new PostgresSink(db);
    await sink.write({
      trades: [
        trade(1, { priceInCents: 5000, quantity: 1, executedAt: BASE_MS + 500 }),
        trade(2, { priceInCents: 5100, quantity: 2, executedAt: BASE_MS + 1000 }),
        trade(3, { priceInCents: 4900, quantity: 3, executedAt: BASE_MS + 3000 }),
        trade(5, { priceInCents: 4950, quantity: 5, executedAt: BASE_MS + 3000 }),
        trade(4, { priceInCents: 5050, quantity: 4, executedAt: BASE_MS + 6000 }),
      ],
      orders: [],
      lastLogSeq: 1,
    });

    const result = await candles(db, "ACME", 5, 10);

    expect(result).toEqual([
      {
        time: BASE_MS / 1000,
        open: 5000,
        high: 5100,
        low: 4900,
        close: 4950,
        volume: 11,
      },
      {
        time: BASE_MS / 1000 + 5,
        open: 5050,
        high: 5050,
        low: 5050,
        close: 5050,
        volume: 4,
      },
    ]);
  });

  it("keeps the database in step with the exchange end to end", async () => {
    const dir = mkdtempSync(join(tmpdir(), "exchange-pg-"));
    const logPath = join(dir, "events.jsonl");

    try {
      const writer = new PersistenceWriter(new PostgresSink(db), {
        onError: () => undefined,
      });
      const state = new ExchangeState(logPath, { persistence: writer });

      const place = (userId: string, side: Side, quantity: number): Order => {
        state.ensureAccount(userId);
        return state.submitOrder({
          id: state.nextOrderId(),
          userId,
          symbol: "ACME",
          side,
          type: "limit",
          priceInCents: 5000,
          maxNotionalInCents: null,
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
      state.cancelOrder("ACME", resting.id);

      await writer.drain();

      expect(await count("trades")).toBe(2);
      expect(await count("orders")).toBe(3);
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