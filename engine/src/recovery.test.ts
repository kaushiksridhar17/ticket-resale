import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ExchangeState } from "./exchangeState.js";
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

  function submit(
    state: ExchangeState,
    userId: string,
    side: "buy" | "sell",
    priceInCents: number,
    quantity: number
  ): Order {
    state.ensureAccount(userId);
    const order: Order = {
      id: state.nextOrderId(),
      userId,
      symbol: "ACME",
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
    const result = state.exchange.submit(order);
    state.recordOrder(result.order);
    state.recordTrades(result.trades);
    return result.order;
  }

  it("starts empty when no log exists", () => {
    const state = new ExchangeState(logPath);

    expect(state.recovered).toBe(0);
    expect(state.exchange.engine.snapshot("ACME").bids).toHaveLength(0);
    state.close();
  });

  it("rebuilds the order book after a restart", () => {
    const first = new ExchangeState(logPath);
    submit(first, "alice", "sell", 5050, 100);
    submit(first, "bob", "buy", 4900, 50);
    first.close();

    const second = new ExchangeState(logPath);

    expect(second.recovered).toBe(2);
    expect(second.exchange.engine.snapshot("ACME").asks[0]).toMatchObject({
      priceInCents: 5050,
      totalQuantity: 100,
    });
    expect(second.exchange.engine.snapshot("ACME").bids[0]).toMatchObject({
      priceInCents: 4900,
      totalQuantity: 50,
    });
    second.close();
  });

  it("produces an identical state digest after recovery", () => {
    const first = new ExchangeState(logPath);
    submit(first, "alice", "sell", 5050, 100);
    submit(first, "bob", "sell", 5075, 80);
    submit(first, "carol", "buy", 5060, 60);
    const before = first.exchange.engine.digest();
    first.close();

    const second = new ExchangeState(logPath);

    expect(second.exchange.engine.digest()).toBe(before);
    second.close();
  });

  it("rebuilds balances from replayed trades", () => {
    const first = new ExchangeState(logPath);
    submit(first, "alice", "sell", 5000, 100);
    submit(first, "bob", "buy", 5000, 100);
    const aliceCash = first.exchange.accounts.get("alice").cash.total;
    const bobShares = first.exchange.accounts.get("bob").positions.get("ACME");
    first.close();

    const second = new ExchangeState(logPath);

    expect(second.exchange.accounts.get("alice").cash.total).toBe(aliceCash);
    expect(second.exchange.accounts.get("bob").positions.get("ACME")?.total).toBe(
      bobShares?.total
    );
    second.close();
  });

  it("restores locked funds for orders still resting", () => {
    const first = new ExchangeState(logPath);
    submit(first, "alice", "buy", 4000, 10);
    first.close();

    const second = new ExchangeState(logPath);

    expect(second.exchange.accounts.get("alice").cash.locked).toBe(40_000);
    second.close();
  });

  it("does not resurrect cancelled orders", () => {
    const first = new ExchangeState(logPath);
    const order = submit(first, "alice", "sell", 5050, 100);
    first.exchange.cancel("ACME", order.id);
    first.close();

    const second = new ExchangeState(logPath);

    expect(second.exchange.engine.snapshot("ACME").asks).toHaveLength(0);
    expect(second.exchange.accounts.get("alice").positions.get("ACME")?.locked).toBe(
      0
    );
    second.close();
  });

  it("issues order ids that do not collide with recovered ones", () => {
    const first = new ExchangeState(logPath);
    submit(first, "alice", "sell", 5050, 100);
    submit(first, "alice", "sell", 5060, 100);
    first.close();

    const second = new ExchangeState(logPath);

    expect(second.nextOrderId()).toBe("ord_3");
    second.close();
  });

  it("does not grow the log during recovery", () => {
    const first = new ExchangeState(logPath);
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
    const first = new ExchangeState(logPath);
    submit(first, "alice", "sell", 5000, 100);
    submit(first, "bob", "buy", 5000, 40);
    first.close();

    const second = new ExchangeState(logPath);

    expect(second.recentTrades("ACME")).toHaveLength(1);
    expect(second.recentTrades("ACME")[0]?.quantity).toBe(40);
    second.close();
  });
});