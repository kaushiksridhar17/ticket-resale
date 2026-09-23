import { beforeEach, describe, expect, it } from "vitest";
import { MatchingEngine } from "./matchingEngine.js";
import { makeOrder, resetOrderCounter } from "./testUtils.js";

const SYMBOL = "evt_demo:GA";

describe("MatchingEngine", () => {
  let engine: MatchingEngine;

  beforeEach(() => {
    engine = new MatchingEngine();
    resetOrderCounter();
  });

  it("rests a limit order when nothing crosses", () => {
    const result = engine.submit(makeOrder("alice", "sell", "limit", 5050, 100));

    expect(result.trades).toHaveLength(0);
    expect(result.order.status).toBe("open");
    expect(engine.snapshot(SYMBOL).asks[0]?.totalQuantity).toBe(100);
  });

  it("executes at the resting order's price, not the incoming price", () => {
    engine.submit(makeOrder("alice", "sell", "limit", 5050, 100));
    const result = engine.submit(makeOrder("bob", "buy", "limit", 5100, 100));

    expect(result.trades).toHaveLength(1);
    expect(result.trades[0]?.priceInCents).toBe(5050);
  });

  it("fills the earliest order first at the same price", () => {
    const first = engine.submit(makeOrder("alice", "sell", "limit", 5050, 50));
    engine.submit(makeOrder("bob", "sell", "limit", 5050, 50));

    const result = engine.submit(makeOrder("carol", "buy", "limit", 5050, 50));

    expect(result.trades[0]?.sellOrderId).toBe(first.order.id);
    expect(result.trades[0]?.sellUserId).toBe("alice");
  });

  it("sweeps multiple price levels best price first", () => {
    engine.submit(makeOrder("alice", "sell", "limit", 5075, 100));
    engine.submit(makeOrder("bob", "sell", "limit", 5050, 100));

    const result = engine.submit(makeOrder("carol", "buy", "limit", 5100, 200));

    expect(result.trades.map((t) => t.priceInCents)).toEqual([5050, 5075]);
    expect(result.order.status).toBe("filled");
  });

  it("rests the remainder of a partially filled limit order", () => {
    engine.submit(makeOrder("alice", "sell", "limit", 5050, 40));
    const result = engine.submit(makeOrder("bob", "buy", "limit", 5050, 100));

    expect(result.order.status).toBe("partially_filled");
    expect(result.order.remainingQuantity).toBe(60);
    expect(engine.snapshot(SYMBOL).bids[0]?.totalQuantity).toBe(60);
  });

  it("cancels the unfilled remainder of a market order instead of resting it", () => {
    engine.submit(makeOrder("alice", "sell", "limit", 5050, 40));
    const result = engine.submit(makeOrder("bob", "buy", "market", null, 100));

    expect(result.order.remainingQuantity).toBe(60);
    expect(result.order.status).toBe("partially_filled");
    expect(engine.snapshot(SYMBOL).bids).toHaveLength(0);
  });

  it("cancels a market order entirely when the book is empty", () => {
    const result = engine.submit(makeOrder("bob", "buy", "market", null, 100));

    expect(result.trades).toHaveLength(0);
    expect(result.order.status).toBe("cancelled");
    expect(engine.snapshot(SYMBOL).bids).toHaveLength(0);
  });

  it("does not match a buy below the best ask", () => {
    engine.submit(makeOrder("alice", "sell", "limit", 5050, 100));
    const result = engine.submit(makeOrder("bob", "buy", "limit", 5025, 100));

    expect(result.trades).toHaveLength(0);
    expect(engine.snapshot(SYMBOL).bids[0]?.priceInCents).toBe(5025);
  });

  it("prevents a user from trading with themselves", () => {
    engine.submit(makeOrder("alice", "sell", "limit", 5050, 100));
    const result = engine.submit(makeOrder("alice", "buy", "limit", 5050, 100));

    expect(result.trades).toHaveLength(0);
  });

  it("removes a cancelled order from the book", () => {
    const resting = engine.submit(makeOrder("alice", "sell", "limit", 5050, 100));
    const cancelled = engine.cancel(SYMBOL, resting.order.id);

    expect(cancelled?.status).toBe("cancelled");
    expect(engine.snapshot(SYMBOL).asks).toHaveLength(0);
  });

  it("keeps symbols isolated from each other", () => {
    engine.submit(makeOrder("alice", "sell", "limit", 5050, 100, SYMBOL));
    const result = engine.submit(
      makeOrder("bob", "buy", "limit", 5050, 100, "ZENX")
    );

    expect(result.trades).toHaveLength(0);
    expect(engine.snapshot(SYMBOL).asks[0]?.totalQuantity).toBe(100);
  });

  it("conserves quantity across every trade", () => {
    engine.submit(makeOrder("alice", "sell", "limit", 5050, 100));
    engine.submit(makeOrder("bob", "sell", "limit", 5075, 100));

    const result = engine.submit(makeOrder("carol", "buy", "limit", 5100, 250));
    const filled = result.trades.reduce((sum, t) => sum + t.quantity, 0);

    expect(filled).toBe(200);
    expect(result.order.quantity).toBe(filled + result.order.remainingQuantity);
  });

  it("assigns strictly increasing sequence numbers to trades", () => {
    engine.submit(makeOrder("alice", "sell", "limit", 5050, 50));
    engine.submit(makeOrder("bob", "sell", "limit", 5075, 50));

    const result = engine.submit(makeOrder("carol", "buy", "limit", 5100, 100));
    const sequences = result.trades.map((t) => t.sequence);

    expect(sequences).toEqual([...sequences].sort((a, b) => a - b));
    expect(new Set(sequences).size).toBe(sequences.length);
  });
});