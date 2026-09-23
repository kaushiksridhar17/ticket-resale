import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ExchangeState, type PersistenceTarget } from "./exchangeState.js";
import {
  DEMO_EVENT_ID,
  DEMO_SYMBOL,
  DEMO_TIER_ID,
  demoEvent,
  seedEvent,
} from "./testEvent.js";
import { OrderRejected } from "./exchange.js";
import type { PersistenceChanges } from "./db/writer.js";
import type { Ticket, TicketTransfer } from "./tickets/types.js";
import type { EventDefinition } from "./events/types.js";
import type { Order, Side, Trade } from "./types.js";

interface Call {
  logSeq: number;
  trades: Trade[];
  orders: Order[];
  events: EventDefinition[];
  tickets: Ticket[];
  transfers: TicketTransfer[];
}

class RecordingTarget implements PersistenceTarget {
  calls: Call[] = [];

  enqueue(logSeq: number, changes: PersistenceChanges): void {
    this.calls.push({
      logSeq,
      trades: (changes.trades ?? []).map((trade) => ({ ...trade })),
      orders: (changes.orders ?? []).map((order) => ({ ...order })),
      events: (changes.events ?? []).map((event) => structuredClone(event)),
      tickets: (changes.tickets ?? []).map((ticket) => ({ ...ticket })),
      transfers: (changes.transfers ?? []).map((transfer) => ({ ...transfer })),
    });
  }

  orderCalls(): Call[] {
    return this.calls.filter(
      (call) => call.trades.length > 0 || call.orders.length > 0
    );
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

    const calls = target.orderCalls();
    expect(calls).toHaveLength(1);
    expect(calls[0]?.logSeq).toBe(base + 1);
    expect(calls[0]?.trades).toHaveLength(0);
    expect(calls[0]?.orders[0]?.status).toBe("open");
    state.close();
  });

  it("includes both sides of a trade with their updated status", () => {
    const target = new RecordingTarget();
    const state = new ExchangeState(logPath, { persistence: target });
    const base = seed(state);

    const resting = state.submitOrder(limitOrder(state, "alice", "sell", 5000, 100));
    const taker = state.submitOrder(limitOrder(state, "bob", "buy", 5000, 40));

    const call = target.orderCalls()[1]!;
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

    const orderCalls = target.orderCalls();
    const last = orderCalls[orderCalls.length - 1]!;
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

    expect(target.orderCalls()).toHaveLength(0);
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

    expect(target.orderCalls().map((call) => call.logSeq)).toEqual([
      base + 1,
      base + 2,
      base + 3,
    ]);
    expect(second.requeuedForDatabase).toBe(7);
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

    expect(target.orderCalls().map((call) => call.logSeq)).toEqual([base + 3]);
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

    expect(target.orderCalls().map((call) => call.logSeq)).toEqual([
      base + 1,
      base + 2,
      base + 3,
    ]);
    second.close();
  });

  it("hands over an event as soon as it is created", () => {
    const target = new RecordingTarget();
    const state = new ExchangeState(logPath, { persistence: target });
    state.createEvent(demoEvent());

    expect(target.calls).toHaveLength(1);
    expect(target.calls[0]?.events[0]?.id).toBe(DEMO_EVENT_ID);
    expect(target.calls[0]?.events[0]?.status).toBe("on_sale");
    state.close();
  });

  it("hands over the new status when sales close", () => {
    const target = new RecordingTarget();
    const state = new ExchangeState(logPath, { persistence: target });
    state.createEvent(demoEvent());
    state.closeSales(DEMO_EVENT_ID);

    const last = target.calls[target.calls.length - 1]!;
    expect(last.events[0]?.status).toBe("closed");
    state.close();
  });

  it("hands over every issued ticket with an origin transfer", () => {
    const target = new RecordingTarget();
    const state = new ExchangeState(logPath, { persistence: target });
    state.createEvent(demoEvent());
    state.issueTickets(DEMO_EVENT_ID, DEMO_TIER_ID, 3, "alice");

    const call = target.calls[target.calls.length - 1]!;
    expect(call.tickets.map((ticket) => ticket.serial)).toEqual([1, 2, 3]);
    expect(call.transfers).toHaveLength(3);
    expect(call.transfers[0]).toMatchObject({
      rotation: 0,
      fromUserId: null,
      toUserId: "alice",
      tradeId: null,
    });
    state.close();
  });

  it("hands over the tickets that moved, tagged with the trade", () => {
    const target = new RecordingTarget();
    const state = new ExchangeState(logPath, { persistence: target });
    const base = seed(state);

    state.submitOrder(limitOrder(state, "alice", "sell", 5000, 2));
    const taker = state.submitOrder(limitOrder(state, "bob", "buy", 5000, 2));

    const call = target.calls[target.calls.length - 1]!;
    expect(call.logSeq).toBe(base + 2);
    expect(call.tickets).toHaveLength(2);
    expect(call.tickets.every((ticket) => ticket.holderId === "bob")).toBe(true);
    expect(call.transfers.map((transfer) => transfer.rotation)).toEqual([1, 1]);
    expect(call.transfers[0]?.tradeId).toBe(taker.trades[0]?.id);
    expect(call.transfers[0]?.fromUserId).toBe("alice");
    state.close();
  });

  it("sends nothing about tickets when an order only rests", () => {
    const target = new RecordingTarget();
    const state = new ExchangeState(logPath, { persistence: target });
    seed(state);

    state.submitOrder(limitOrder(state, "alice", "sell", 5000, 2));

    const call = target.calls[target.calls.length - 1]!;
    expect(call.tickets).toHaveLength(0);
    expect(call.transfers).toHaveLength(0);
    state.close();
  });
});