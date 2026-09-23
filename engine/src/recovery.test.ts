import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ExchangeState } from "./exchangeState.js";
import { DEMO_SYMBOL, seedEvent } from "./testEvent.js";
import type { Order } from "./types.js";

describe("startup recovery", () => {
  let dir: string;
  let logPath: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "exchange-recovery-"));
    logPath = join(dir, "events.jsonl");
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function freshState(): ExchangeState {
    const state = new ExchangeState(logPath);
    seedEvent(state, { issueTo: ["alice", "bob", "carol"], count: 1000 });
    return state;
  }

  function submit(
    state: ExchangeState,
    userId: string,
    side: "buy" | "sell",
    priceInCents: number,
    quantity: number
  ): Order {
    state.ensureAccount(userId);
    return state.submitOrder({
      id: state.nextOrderId(),
      userId,
      symbol: DEMO_SYMBOL,
      side,
      type: "limit",
      priceInCents,
      quantity,
      remainingQuantity: quantity,
      status: "open",
      sequence: 0,
      createdAt: 1_700_000_000_000,
    }).order;
  }

  it("starts empty when no log exists", () => {
    const state = new ExchangeState(logPath);

    expect(state.recovered).toBe(0);
    expect(state.symbols()).toHaveLength(0);
    state.close();
  });

  it("recovers the event itself, not just the orders", () => {
    const first = freshState();
    first.close();

    const second = new ExchangeState(logPath);

    expect(second.symbols()).toContain(DEMO_SYMBOL);
    expect(second.heldTickets("alice", DEMO_SYMBOL)).toBe(1000);
    second.close();
  });

  it("rebuilds the order book after a restart", () => {
    const first = freshState();
    submit(first, "alice", "sell", 5050, 100);
    submit(first, "bob", "buy", 4900, 50);
    const commands = first.logPosition();
    first.close();

    const second = new ExchangeState(logPath);

    expect(second.recovered).toBe(commands);
    expect(second.exchange.engine.snapshot(DEMO_SYMBOL).asks[0]).toMatchObject({
      priceInCents: 5050,
      totalQuantity: 100,
    });
    expect(second.exchange.engine.snapshot(DEMO_SYMBOL).bids[0]).toMatchObject({
      priceInCents: 4900,
      totalQuantity: 50,
    });
    second.close();
  });

  it("produces an identical state digest after recovery", () => {
    const first = freshState();
    submit(first, "alice", "sell", 5050, 100);
    submit(first, "bob", "sell", 5075, 80);
    submit(first, "carol", "buy", 5060, 60);
    const before = first.exchange.engine.digest();
    first.close();

    const second = new ExchangeState(logPath);

    expect(second.exchange.engine.digest()).toBe(before);
    second.close();
  });

  it("rebuilds holdings from replayed trades", () => {
    const first = freshState();
    submit(first, "alice", "sell", 5000, 100);
    submit(first, "bob", "buy", 5000, 100);
    const aliceTickets = first.heldTickets("alice", DEMO_SYMBOL);
    const bobTickets = first.heldTickets("bob", DEMO_SYMBOL);
    first.close();

    const second = new ExchangeState(logPath);

    expect(second.heldTickets("alice", DEMO_SYMBOL)).toBe(aliceTickets);
    expect(second.heldTickets("bob", DEMO_SYMBOL)).toBe(bobTickets);
    second.close();
  });

  it("keeps a seller's listed tickets set aside after a restart", () => {
    const first = freshState();
    submit(first, "alice", "sell", 4000, 10);
    first.close();

    const second = new ExchangeState(logPath);
    const position = second.exchange.accounts.get("alice").positions.get(DEMO_SYMBOL);

    expect(position?.locked).toBe(10);
    expect(second.exchange.accounts.available("alice", DEMO_SYMBOL)).toBe(990);
    second.close();
  });

  it("does not resurrect cancelled orders", () => {
    const first = freshState();
    const order = submit(first, "alice", "sell", 5050, 100);
    first.cancelOrder(DEMO_SYMBOL, order.id);
    first.close();

    const second = new ExchangeState(logPath);

    expect(second.exchange.engine.snapshot(DEMO_SYMBOL).asks).toHaveLength(0);
    expect(
      second.exchange.accounts.get("alice").positions.get(DEMO_SYMBOL)?.locked
    ).toBe(0);
    second.close();
  });

  it("issues order ids that do not collide with recovered ones", () => {
    const first = freshState();
    submit(first, "alice", "sell", 5050, 100);
    submit(first, "alice", "sell", 5060, 100);
    first.close();

    const second = new ExchangeState(logPath);

    expect(second.nextOrderId()).toBe("ord_3");
    second.close();
  });

  it("does not grow the log during recovery", () => {
    const first = freshState();
    submit(first, "alice", "sell", 5050, 100);
    submit(first, "bob", "buy", 4900, 50);
    first.close();

    const second = new ExchangeState(logPath);
    const countAfterFirstRecovery = second.recovered;
    second.close();

    const third = new ExchangeState(logPath);

    expect(third.recovered).toBe(countAfterFirstRecovery);
    third.close();
  });

  it("keeps recovered trades visible in the feed", () => {
    const first = freshState();
    submit(first, "alice", "sell", 5000, 100);
    submit(first, "bob", "buy", 5000, 40);
    first.close();

    const second = new ExchangeState(logPath);

    expect(second.recentTrades(DEMO_SYMBOL)).toHaveLength(1);
    expect(second.recentTrades(DEMO_SYMBOL)[0]?.quantity).toBe(40);
    second.close();
  });
});
