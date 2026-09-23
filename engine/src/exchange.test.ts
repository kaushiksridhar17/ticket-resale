import { beforeEach, describe, expect, it } from "vitest";
import { Exchange, OrderRejected } from "./exchange.js";
import { makeOrder, resetOrderCounter } from "./testUtils.js";

describe("Exchange", () => {
  let exchange: Exchange;

  beforeEach(() => {
    resetOrderCounter();
    exchange = new Exchange();
    exchange.accounts.open("alice", 1_000_00);
    exchange.accounts.open("bob", 1_000_00);
    exchange.accounts.open("carol", 1_000_00);
    exchange.accounts.credit("bob", "ACME", 100);
    exchange.accounts.credit("carol", "ACME", 100);
  });

  it("rejects an order from an unknown account", () => {
    expect(() =>
      exchange.submit(makeOrder("nobody", "buy", "limit", 5000, 10))
    ).toThrow(OrderRejected);
  });

  it("rejects an order with zero or negative quantity", () => {
    expect(() =>
      exchange.submit(makeOrder("alice", "buy", "limit", 5000, 0))
    ).toThrow(OrderRejected);
    expect(() =>
      exchange.submit(makeOrder("alice", "buy", "limit", 5000, -5))
    ).toThrow(OrderRejected);
  });

  it("rejects a limit order without a price", () => {
    expect(() =>
      exchange.submit(makeOrder("alice", "buy", "limit", null, 10))
    ).toThrow(OrderRejected);
  });

  it("rejects a market buy without a notional cap", () => {
    expect(() =>
      exchange.submit(makeOrder("alice", "buy", "market", null, 10))
    ).toThrow(OrderRejected);
  });

  it("leaves no trace when an order is rejected for insufficient funds", () => {
    const cashBefore = exchange.accounts.availableCash("alice");

    expect(() =>
      exchange.submit(makeOrder("alice", "buy", "limit", 5000, 1000))
    ).toThrow(OrderRejected);

    expect(exchange.accounts.availableCash("alice")).toBe(cashBefore);
    expect(exchange.engine.snapshot("ACME").bids).toHaveLength(0);
  });

  it("rejects selling shares the user does not own", () => {
    expect(() =>
      exchange.submit(makeOrder("alice", "sell", "limit", 5000, 10))
    ).toThrow(OrderRejected);
  });

  it("locks funds for a resting buy order", () => {
    exchange.submit(makeOrder("alice", "buy", "limit", 5000, 10));

    expect(exchange.accounts.get("alice").cash.locked).toBe(50_000);
    expect(exchange.accounts.availableCash("alice")).toBe(1_000_00 - 50_000);
  });

  it("settles cash and shares when a trade executes", () => {
    exchange.submit(makeOrder("bob", "sell", "limit", 5000, 10));
    exchange.submit(makeOrder("alice", "buy", "limit", 5000, 10));

    expect(exchange.accounts.get("alice").cash.total).toBe(1_000_00 - 50_000);
    expect(exchange.accounts.get("bob").cash.total).toBe(1_000_00 + 50_000);
    expect(exchange.accounts.availableShares("alice", "ACME")).toBe(10);
    expect(exchange.accounts.availableShares("bob", "ACME")).toBe(90);
    exchange.accounts.assertInvariants();
  });

  it("returns unspent cash to the buyer on price improvement", () => {
    exchange.submit(makeOrder("bob", "sell", "limit", 4500, 10));
    exchange.submit(makeOrder("alice", "buy", "limit", 5000, 10));

    expect(exchange.accounts.get("alice").cash.locked).toBe(0);
    expect(exchange.accounts.availableCash("alice")).toBe(1_000_00 - 45_000);
    exchange.accounts.assertInvariants();
  });

  it("keeps the unfilled remainder locked for a partially filled buy", () => {
    exchange.submit(makeOrder("bob", "sell", "limit", 5000, 4));
    exchange.submit(makeOrder("alice", "buy", "limit", 5000, 10));

    expect(exchange.accounts.get("alice").cash.locked).toBe(6 * 5000);
    expect(exchange.accounts.get("alice").cash.total).toBe(1_000_00 - 20_000);
    exchange.accounts.assertInvariants();
  });

  it("releases everything when a resting order is cancelled", () => {
    const result = exchange.submit(makeOrder("alice", "buy", "limit", 5000, 10));
    exchange.cancel("ACME", result.order.id);

    expect(exchange.accounts.get("alice").cash.locked).toBe(0);
    expect(exchange.accounts.availableCash("alice")).toBe(1_000_00);
    exchange.accounts.assertInvariants();
  });

  it("releases locked shares when a sell order is cancelled", () => {
    const result = exchange.submit(makeOrder("bob", "sell", "limit", 5000, 40));
    expect(exchange.accounts.availableShares("bob", "ACME")).toBe(60);

    exchange.cancel("ACME", result.order.id);

    expect(exchange.accounts.availableShares("bob", "ACME")).toBe(100);
    exchange.accounts.assertInvariants();
  });

  it("releases the cap when a market buy finds no liquidity", () => {
    const result = exchange.submit(
      makeOrder("alice", "buy", "market", null, 10, "ACME", 60_000)
    );

    expect(result.order.status).toBe("cancelled");
    expect(exchange.accounts.get("alice").cash.locked).toBe(0);
    expect(exchange.accounts.availableCash("alice")).toBe(1_000_00);
  });

  it("releases the unspent cap after a market buy partially fills", () => {
    exchange.submit(makeOrder("bob", "sell", "limit", 5000, 4));
    const result = exchange.submit(
      makeOrder("alice", "buy", "market", null, 10, "ACME", 60_000)
    );

    expect(result.order.status).toBe("partially_filled");
    expect(exchange.accounts.get("alice").cash.locked).toBe(0);
    expect(exchange.accounts.availableCash("alice")).toBe(1_000_00 - 20_000);
    exchange.accounts.assertInvariants();
  });

  it("releases locked shares when a market sell finds no liquidity", () => {
    const result = exchange.submit(makeOrder("bob", "sell", "market", null, 10));

    expect(result.order.status).toBe("cancelled");
    expect(exchange.accounts.availableShares("bob", "ACME")).toBe(100);
  });

  it("releases unfilled shares after a market sell partially fills", () => {
    exchange.submit(makeOrder("alice", "buy", "limit", 5000, 4));
    const result = exchange.submit(makeOrder("bob", "sell", "market", null, 10));

    expect(result.order.status).toBe("partially_filled");
    expect(exchange.accounts.get("bob").positions.get("ACME")?.locked).toBe(0);
    expect(exchange.accounts.availableShares("bob", "ACME")).toBe(96);
    exchange.accounts.assertInvariants();
  });

  it("leaves no shares locked once every market order has finished", () => {
    exchange.submit(makeOrder("alice", "buy", "limit", 5000, 3));
    exchange.submit(makeOrder("alice", "buy", "limit", 4900, 3));
    exchange.submit(makeOrder("bob", "sell", "market", null, 50));
    exchange.submit(makeOrder("carol", "sell", "market", null, 50));

    expect(exchange.accounts.get("bob").positions.get("ACME")?.locked).toBe(0);
    expect(exchange.accounts.get("carol").positions.get("ACME")?.locked).toBe(0);
    exchange.accounts.assertInvariants();
  });

  it("prevents a user from spending the same cash twice", () => {
    exchange.submit(makeOrder("alice", "buy", "limit", 5000, 20));

    expect(() =>
      exchange.submit(makeOrder("alice", "buy", "limit", 5000, 1))
    ).toThrow(OrderRejected);
  });

  it("prevents a user from selling the same shares twice", () => {
    exchange.submit(makeOrder("bob", "sell", "limit", 5000, 100));

    expect(() =>
      exchange.submit(makeOrder("bob", "sell", "limit", 5000, 1))
    ).toThrow(OrderRejected);
  });

  it("conserves total cash and shares across a sweep", () => {
    const cashBefore = exchange.accounts.totalCash();
    const sharesBefore = exchange.accounts.totalShares("ACME");

    exchange.submit(makeOrder("bob", "sell", "limit", 500, 50));
    exchange.submit(makeOrder("carol", "sell", "limit", 510, 50));
    exchange.submit(makeOrder("alice", "buy", "limit", 520, 100));

    expect(exchange.accounts.totalCash()).toBe(cashBefore);
    expect(exchange.accounts.totalShares("ACME")).toBe(sharesBefore);
    exchange.accounts.assertInvariants();
  });
});