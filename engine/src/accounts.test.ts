import { beforeEach, describe, expect, it } from "vitest";
import { Accounts, NothingToGive } from "./accounts.js";
import { makeOrder, resetOrderCounter } from "./testUtils.js";
import type { Trade } from "./types.js";

const SYMBOL = "evt_demo:GA";

function trade(quantity: number, priceInCents = 1500): Trade {
  return {
    id: "trd_1",
    symbol: SYMBOL,
    priceInCents,
    quantity,
    buyOrderId: "ord_b",
    sellOrderId: "ord_s",
    buyUserId: "alice",
    sellUserId: "bob",
    takerSide: "buy",
    sequence: 1,
    executedAt: 1_700_000_000_000,
  };
}

describe("Accounts", () => {
  let accounts: Accounts;

  beforeEach(() => {
    resetOrderCounter();
    accounts = new Accounts();
    accounts.open("alice");
    accounts.open("bob");
  });

  it("opens an account holding nothing", () => {
    expect(accounts.available("alice", SYMBOL)).toBe(0);
    expect(accounts.get("alice").positions.size).toBe(0);
  });

  it("refuses to open the same account twice", () => {
    expect(() => accounts.open("alice")).toThrow();
  });

  it("throws for an account that was never opened", () => {
    expect(() => accounts.get("nobody")).toThrow();
    expect(accounts.has("nobody")).toBe(false);
  });

  it("lists everyone who has an account", () => {
    expect(accounts.userIds().sort()).toEqual(["alice", "bob"]);
  });

  it("credits tickets into an account", () => {
    accounts.credit("bob", SYMBOL, 10);

    expect(accounts.available("bob", SYMBOL)).toBe(10);
    expect(accounts.totalHeld(SYMBOL)).toBe(10);
  });

  it("sets nothing aside for a buyer", () => {
    accounts.reserve(makeOrder("alice", "buy", "limit", 1500, 4, SYMBOL));

    expect(accounts.get("alice").positions.size).toBe(0);
  });

  it("sets a seller's tickets aside so they cannot be offered twice", () => {
    accounts.credit("bob", SYMBOL, 10);
    accounts.reserve(makeOrder("bob", "sell", "limit", 1500, 6, SYMBOL));

    expect(accounts.available("bob", SYMBOL)).toBe(4);
    expect(accounts.get("bob").positions.get(SYMBOL)?.total).toBe(10);
  });

  it("refuses to offer tickets that are not there", () => {
    accounts.credit("bob", SYMBOL, 3);

    expect(() =>
      accounts.reserve(makeOrder("bob", "sell", "limit", 1500, 4, SYMBOL))
    ).toThrow(NothingToGive);
  });

  it("refuses to offer the same ticket on two listings", () => {
    accounts.credit("bob", SYMBOL, 5);
    accounts.reserve(makeOrder("bob", "sell", "limit", 1500, 5, SYMBOL));

    expect(() =>
      accounts.reserve(makeOrder("bob", "sell", "limit", 1400, 1, SYMBOL))
    ).toThrow(NothingToGive);
  });

  it("gives back what a withdrawn listing was holding", () => {
    accounts.credit("bob", SYMBOL, 10);
    const order = makeOrder("bob", "sell", "limit", 1500, 6, SYMBOL);
    accounts.reserve(order);
    accounts.release(order, 6);

    expect(accounts.available("bob", SYMBOL)).toBe(10);
  });

  it("gives nothing back to a buyer", () => {
    const order = makeOrder("alice", "buy", "limit", 1500, 6, SYMBOL);
    accounts.reserve(order);
    accounts.release(order, 6);

    expect(accounts.get("alice").positions.size).toBe(0);
  });

  it("moves tickets from seller to buyer when a trade settles", () => {
    accounts.credit("bob", SYMBOL, 10);
    accounts.reserve(makeOrder("bob", "sell", "limit", 1500, 4, SYMBOL));

    accounts.settle(trade(4));

    expect(accounts.available("bob", SYMBOL)).toBe(6);
    expect(accounts.available("alice", SYMBOL)).toBe(4);
    expect(accounts.totalHeld(SYMBOL)).toBe(10);
    accounts.assertInvariants();
  });

  it("keeps the total unchanged however many times tickets move", () => {
    accounts.open("carol");
    accounts.credit("bob", SYMBOL, 8);

    accounts.reserve(makeOrder("bob", "sell", "limit", 1500, 8, SYMBOL));
    accounts.settle(trade(8));

    accounts.reserve(makeOrder("alice", "sell", "limit", 1500, 3, SYMBOL));
    accounts.settle({
      ...trade(3),
      id: "trd_2",
      buyUserId: "carol",
      sellUserId: "alice",
    });

    expect(accounts.totalHeld(SYMBOL)).toBe(8);
    expect(accounts.available("alice", SYMBOL)).toBe(5);
    expect(accounts.available("carol", SYMBOL)).toBe(3);
    accounts.assertInvariants();
  });

  it("notices an account holding fewer tickets than it has set aside", () => {
    accounts.credit("bob", SYMBOL, 4);
    accounts.get("bob").positions.get(SYMBOL)!.locked = 5;

    expect(() => accounts.assertInvariants()).toThrow();
  });

  it("notices an account that has gone short", () => {
    accounts.credit("bob", SYMBOL, 1);
    accounts.get("bob").positions.get(SYMBOL)!.total = -1;

    expect(() => accounts.assertInvariants()).toThrow();
  });
});
