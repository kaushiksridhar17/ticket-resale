import { beforeEach, describe, expect, it } from "vitest";
import { Exchange, OrderRejected } from "./exchange.js";
import { makeOrder, resetOrderCounter } from "./testUtils.js";

const SYMBOL = "evt_demo:GA";

describe("Exchange", () => {
  let exchange: Exchange;

  beforeEach(() => {
    resetOrderCounter();
    exchange = new Exchange();
    exchange.accounts.open("alice");
    exchange.accounts.open("bob");
    exchange.accounts.open("carol");
    exchange.accounts.credit("bob", SYMBOL, 100);
    exchange.accounts.credit("carol", SYMBOL, 100);
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

  it("rejects a market order that carries a price", () => {
    expect(() =>
      exchange.submit(makeOrder("alice", "buy", "market", 5000, 10))
    ).toThrow(OrderRejected);
  });

  it("rejects selling what the user does not hold", () => {
    expect(() =>
      exchange.submit(makeOrder("alice", "sell", "limit", 5000, 10))
    ).toThrow(OrderRejected);
  });

  it("leaves no trace when a sell is rejected", () => {
    expect(() =>
      exchange.submit(makeOrder("bob", "sell", "limit", 5000, 1000))
    ).toThrow(OrderRejected);

    expect(exchange.accounts.available("bob", SYMBOL)).toBe(100);
    expect(exchange.engine.snapshot(SYMBOL).asks).toHaveLength(0);
  });

  it("sets nothing aside for a resting buy", () => {
    exchange.submit(makeOrder("alice", "buy", "limit", 5000, 10));

    expect(exchange.accounts.get("alice").positions.size).toBe(0);
    expect(exchange.engine.snapshot(SYMBOL).bids).toHaveLength(1);
  });

  it("sets a seller's tickets aside while their offer rests", () => {
    exchange.submit(makeOrder("bob", "sell", "limit", 5000, 40));

    expect(exchange.accounts.available("bob", SYMBOL)).toBe(60);
    exchange.accounts.assertInvariants();
  });

  it("hands tickets over when a trade executes", () => {
    exchange.submit(makeOrder("bob", "sell", "limit", 5000, 10));
    exchange.submit(makeOrder("alice", "buy", "limit", 5000, 10));

    expect(exchange.accounts.available("alice", SYMBOL)).toBe(10);
    expect(exchange.accounts.available("bob", SYMBOL)).toBe(90);
    exchange.accounts.assertInvariants();
  });

  it("fills a buyer at the seller's price, not their own limit", () => {
    exchange.submit(makeOrder("bob", "sell", "limit", 4500, 10));
    const result = exchange.submit(makeOrder("alice", "buy", "limit", 5000, 10));

    expect(result.trades).toHaveLength(1);
    expect(result.trades[0]?.priceInCents).toBe(4500);
    exchange.accounts.assertInvariants();
  });

  it("leaves the unfilled part of a buy resting in the book", () => {
    exchange.submit(makeOrder("bob", "sell", "limit", 5000, 4));
    const result = exchange.submit(makeOrder("alice", "buy", "limit", 5000, 10));

    expect(result.order.status).toBe("partially_filled");
    expect(result.order.remainingQuantity).toBe(6);
    expect(exchange.accounts.available("alice", SYMBOL)).toBe(4);
    exchange.accounts.assertInvariants();
  });

  it("takes a cancelled buy out of the book", () => {
    const result = exchange.submit(makeOrder("alice", "buy", "limit", 5000, 10));
    exchange.cancel(SYMBOL, result.order.id);

    expect(exchange.engine.snapshot(SYMBOL).bids).toHaveLength(0);
    exchange.accounts.assertInvariants();
  });

  it("gives a seller their tickets back when an offer is withdrawn", () => {
    const result = exchange.submit(makeOrder("bob", "sell", "limit", 5000, 40));
    expect(exchange.accounts.available("bob", SYMBOL)).toBe(60);

    exchange.cancel(SYMBOL, result.order.id);

    expect(exchange.accounts.available("bob", SYMBOL)).toBe(100);
    exchange.accounts.assertInvariants();
  });

  it("gives a seller their tickets back when a market sell finds nobody", () => {
    const result = exchange.submit(makeOrder("bob", "sell", "market", null, 10));

    expect(result.order.status).toBe("cancelled");
    expect(exchange.accounts.available("bob", SYMBOL)).toBe(100);
  });

  it("gives back only the unsold part of a market sell", () => {
    exchange.submit(makeOrder("alice", "buy", "limit", 5000, 4));
    const result = exchange.submit(makeOrder("bob", "sell", "market", null, 10));

    expect(result.order.status).toBe("partially_filled");
    expect(exchange.accounts.get("bob").positions.get(SYMBOL)?.locked).toBe(0);
    expect(exchange.accounts.available("bob", SYMBOL)).toBe(96);
    exchange.accounts.assertInvariants();
  });

  it("leaves nothing set aside once every market order has finished", () => {
    exchange.submit(makeOrder("alice", "buy", "limit", 5000, 3));
    exchange.submit(makeOrder("alice", "buy", "limit", 4900, 3));
    exchange.submit(makeOrder("bob", "sell", "market", null, 50));
    exchange.submit(makeOrder("carol", "sell", "market", null, 50));

    expect(exchange.accounts.get("bob").positions.get(SYMBOL)?.locked).toBe(0);
    expect(exchange.accounts.get("carol").positions.get(SYMBOL)?.locked).toBe(0);
    exchange.accounts.assertInvariants();
  });

  it("prevents a user from offering the same ticket twice", () => {
    exchange.submit(makeOrder("bob", "sell", "limit", 5000, 100));

    expect(() =>
      exchange.submit(makeOrder("bob", "sell", "limit", 5000, 1))
    ).toThrow(OrderRejected);
  });

  it("conserves the total across a sweep of several sellers", () => {
    const before = exchange.accounts.totalHeld(SYMBOL);

    exchange.submit(makeOrder("bob", "sell", "limit", 500, 50));
    exchange.submit(makeOrder("carol", "sell", "limit", 510, 50));
    exchange.submit(makeOrder("alice", "buy", "limit", 520, 100));

    expect(exchange.accounts.totalHeld(SYMBOL)).toBe(before);
    expect(exchange.accounts.available("alice", SYMBOL)).toBe(100);
    exchange.accounts.assertInvariants();
  });
});
