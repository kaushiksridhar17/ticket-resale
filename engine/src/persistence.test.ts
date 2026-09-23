import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ExchangeState, type PersistenceTarget } from "./exchangeState.js";
import { DEMO_SYMBOL, seedEvent } from "./testEvent.js";
import { OrderRejected } from "./exchange.js";
import type { Order, Side, Trade } from "./types.js";

interface Call {
  logSeq: number;
  trades: Trade[];
  orders: Order[];
}

class RecordingTarget implements PersistenceTarget {
  calls: Call[] = [];

  enqueue(logSeq: number, trades: Trade[], orders: Order[]): void {
    this.calls.push({
      logSeq,
      trades: trades.map((trade) => ({ ...trade })),
      orders: orders.map((order) => ({ ...order })),
    });
  }
}

function seed(state: ExchangeState): number {
  seedEvent(state, { issueTo: ["alice", "bob", "carol"], count: 1000 });
  return state.logPosition();
}

function limitOrder(
  state: ExchangeState,
  userId: string,
  side: Side,
  priceInCents: number,
  quantity: number
): Order {
  state.ensureAccount(userId);
  return {
    id: state.nextOrderId(),
    userId,
    symbol: DEMO_SYMBOL,
    side,
    type: "limit",
    priceInCents,
    maxNotionalInCents: null,
    quantity,
    remainingQuantity: quantity,
    status: "open",
    sequence: 0,
    createdAt: 1_700_000_000_000,
  };
}

describe("persistence wiring", () => {
  let dir: string;
  let logPath: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "exchange-persist-"));
    logPath = join(dir, "events.jsonl");
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("hands over a resting order with its log position", () => {
    const target = new RecordingTarget();
    const state = new ExchangeState(logPath, { persistence: target });
    const base = seed(state);

    state.submitOrder(limitOrder(state, "alice", "sell", 5000, 100));

    expect(target.calls).toHaveLength(1);
    expect(target.calls[0]?.logSeq).toBe(base + 1);
    expect(target.calls[0]?.trades).toHaveLength(0);
    expect(target.calls[0]?.orders[0]?.status).toBe("open");
    state.close();
  });

  it("includes both sides of a trade with their updated status", () => {
    const target = new RecordingTarget();
    const state = new ExchangeState(logPath, { persistence: target });
    const base = seed(state);

    const resting = state.submitOrder(limitOrder(state, "alice", "sell", 5000, 100));
    const taker = state.submitOrder(limitOrder(state, "bob", "buy", 5000, 40));

    const call = target.calls[1]!;
    expect(call.logSeq).toBe(base + 2);
    expect(call.trades).toHaveLength(1);

    const maker = call.orders.find((order) => order.id === resting.order.id);
    const incoming = call.orders.find((order) => order.id === taker.order.id);
    expect(maker?.remainingQuantity).toBe(60);
    expect(maker?.status).toBe("partially_filled");
    expect(incoming?.status).toBe("filled");
    state.close();
  });

  it("hands over a cancellation", () => {
    const target = new RecordingTarget();
    const state = new ExchangeState(logPath, { persistence: target });
    const base = seed(state);

    const placed = state.submitOrder(limitOrder(state, "alice", "sell", 5000, 100));
    state.cancelOrder(DEMO_SYMBOL, placed.order.id);

    const last = target.calls[target.calls.length - 1]!;
    expect(last.logSeq).toBe(base + 2);
    expect(last.orders[0]?.status).toBe("cancelled");
    state.close();
  });

  it("does not hand over rejected orders", () => {
    const target = new RecordingTarget();
    const state = new ExchangeState(logPath, { persistence: target });
    seed(state);

    expect(() =>
      state.submitOrder(limitOrder(state, "alice", "buy", 5000, 1_000_000))
    ).toThrow(OrderRejected);

    expect(target.calls).toHaveLength(0);
    state.close();
  });

  it("re-queues every command on recovery when the database is empty", () => {
    const first = new ExchangeState(logPath);
    const base = seed(first);
    first.submitOrder(limitOrder(first, "alice", "sell", 5000, 100));
    first.submitOrder(limitOrder(first, "bob", "buy", 5000, 40));
    first.submitOrder(limitOrder(first, "carol", "buy", 4900, 10));
    first.close();

    const target = new RecordingTarget();
    const second = new ExchangeState(logPath, {
      persistence: target,
      lastPersistedLogSeq: 0,
    });

    expect(target.calls.map((call) => call.logSeq)).toEqual([
      base + 1,
      base + 2,
      base + 3,
    ]);
    expect(second.requeuedForDatabase).toBe(3);
    second.close();
  });

  it("skips commands the database already has", () => {
    const first = new ExchangeState(logPath);
    const base = seed(first);
    first.submitOrder(limitOrder(first, "alice", "sell", 5000, 100));
    first.submitOrder(limitOrder(first, "bob", "buy", 5000, 40));
    first.submitOrder(limitOrder(first, "carol", "buy", 4900, 10));
    first.close();

    const target = new RecordingTarget();
    const second = new ExchangeState(logPath, {
      persistence: target,
      lastPersistedLogSeq: base + 2,
    });

    expect(target.calls.map((call) => call.logSeq)).toEqual([base + 3]);
    second.close();
  });

  it("continues log positions from recovery into live traffic", () => {
    const first = new ExchangeState(logPath);
    const base = seed(first);
    first.submitOrder(limitOrder(first, "alice", "sell", 5000, 100));
    first.submitOrder(limitOrder(first, "bob", "buy", 4900, 10));
    first.close();

    const target = new RecordingTarget();
    const second = new ExchangeState(logPath, { persistence: target });
    second.submitOrder(limitOrder(second, "carol", "buy", 4800, 10));

    expect(target.calls.map((call) => call.logSeq)).toEqual([
      base + 1,
      base + 2,
      base + 3,
    ]);
    second.close();
  });
});