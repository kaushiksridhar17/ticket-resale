import { beforeEach, describe, expect, it } from "vitest";
import { Accounts, InsufficientFunds } from "./accounts.js";
import { makeOrder, resetOrderCounter } from "./testUtils.js";
import type { Trade } from "./types.js";

function makeTrade(
  buyUserId: string,
  sellUserId: string,
  priceInCents: number,
  quantity: number,
  symbol = "ACME"
): Trade {
  return {
    id: "trd_1",
    symbol,
    priceInCents,
    quantity,
    buyOrderId: "ord_buy",
    sellOrderId: "ord_sell",
    buyUserId,
    sellUserId,
    takerSide: "buy",
    sequence: 1,
    executedAt: 1_700_000_000_000,
  };
}

describe("Accounts", () => {
  let accounts: Accounts;

  beforeEach(() => {
    accounts = new Accounts();
    resetOrderCounter();
    accounts.open("alice", 1_000_00);
    accounts.open("bob", 1_000_00);
    accounts.credit("bob", "ACME", 100);
  });

  it("reports available cash as total minus locked", () => {
    expect(accounts.availableCash("alice")).toBe(1_000_00);

    accounts.reserve(makeOrder("alice", "buy", "limit", 900, 100));

    expect(accounts.availableCash("alice")).toBe(1_000_00 - 90_000);
    expect(accounts.get("alice").cash.total).toBe(1_000_00);
  });

  it("rejects a second order that exceeds available cash", () => {
    accounts.reserve(makeOrder("alice", "buy", "limit", 900, 100));

    expect(() =>
      accounts.reserve(makeOrder("alice", "buy", "limit", 900, 100))
    ).toThrow(InsufficientFunds);

    expect(accounts.get("alice").cash.locked).toBe(90_000);
  });

  it("reserves the notional cap for a market buy", () => {
    const order = makeOrder("alice", "buy", "market", null, 50, "ACME", 60_000);
    accounts.reserve(order);

    expect(accounts.get("alice").cash.locked).toBe(60_000);
    expect(accounts.availableCash("alice")).toBe(1_000_00 - 60_000);
  });

  it("rejects selling shares the user does not hold", () => {
    expect(() =>
      accounts.reserve(makeOrder("alice", "sell", "limit", 5000, 10))
    ).toThrow(InsufficientFunds);
  });

  it("rejects selling the same shares twice", () => {
    accounts.reserve(makeOrder("bob", "sell", "limit", 5000, 100));

    expect(() =>
      accounts.reserve(makeOrder("bob", "sell", "limit", 5000, 1))
    ).toThrow(InsufficientFunds);

    expect(accounts.availableShares("bob", "ACME")).toBe(0);
  });

  it("returns locked funds when a buy order is cancelled unfilled", () => {
    const order = makeOrder("alice", "buy", "limit", 900, 100);
    accounts.reserve(order);
    accounts.releaseBuyRemainder(order, 0);

    expect(accounts.availableCash("alice")).toBe(1_000_00);
    expect(accounts.get("alice").cash.locked).toBe(0);
  });

  it("releases only the unfilled portion for a seller", () => {
    const order = makeOrder("bob", "sell", "limit", 900, 100);
    accounts.reserve(order);
    accounts.release(order, 40);

    expect(accounts.get("bob").positions.get("ACME")?.locked).toBe(60);
  });

  it("moves cash and shares between the two sides on settlement", () => {
    const buy = makeOrder("alice", "buy", "limit", 900, 50);
    const sell = makeOrder("bob", "sell", "limit", 900, 50);
    accounts.reserve(buy);
    accounts.reserve(sell);

    accounts.settle(makeTrade("alice", "bob", 900, 50));
    accounts.releaseBuyRemainder(buy, 0);

    expect(accounts.get("alice").cash.total).toBe(1_000_00 - 45_000);
    expect(accounts.get("bob").cash.total).toBe(1_000_00 + 45_000);
    expect(accounts.get("alice").positions.get("ACME")?.total).toBe(50);
    expect(accounts.get("bob").positions.get("ACME")?.total).toBe(50);
    accounts.assertInvariants();
  });

  it("refunds the difference when a buyer fills below their limit price", () => {
    const buy = makeOrder("alice", "buy", "limit", 1000, 50);
    const sell = makeOrder("bob", "sell", "limit", 900, 50);
    accounts.reserve(buy);
    accounts.reserve(sell);

    accounts.settle(makeTrade("alice", "bob", 900, 50));
    accounts.releaseBuyRemainder(buy, 0);

    expect(accounts.get("alice").cash.total).toBe(1_000_00 - 45_000);
    expect(accounts.get("alice").cash.locked).toBe(0);
    expect(accounts.availableCash("alice")).toBe(1_000_00 - 45_000);
    accounts.assertInvariants();
  });

  it("settles partial fills of the same order independently", () => {
    const buy = makeOrder("alice", "buy", "limit", 900, 100);
    const sell = makeOrder("bob", "sell", "limit", 900, 100);
    accounts.reserve(buy);
    accounts.reserve(sell);

    accounts.settle(makeTrade("alice", "bob", 900, 30));
    accounts.settle(makeTrade("alice", "bob", 900, 70));
    accounts.releaseBuyRemainder(buy, 0);

    expect(accounts.get("alice").cash.locked).toBe(0);
    expect(accounts.get("alice").positions.get("ACME")?.total).toBe(100);
    expect(accounts.get("bob").positions.get("ACME")?.total).toBe(0);
    accounts.assertInvariants();
  });

  it("conserves total cash and total shares across settlement", () => {
    const cashBefore = accounts.totalCash();
    const sharesBefore = accounts.totalShares("ACME");

    const buy = makeOrder("alice", "buy", "limit", 900, 50);
    const sell = makeOrder("bob", "sell", "limit", 900, 50);
    accounts.reserve(buy);
    accounts.reserve(sell);
    accounts.settle(makeTrade("alice", "bob", 900, 50));
    accounts.releaseBuyRemainder(buy, 0);

    expect(accounts.totalCash()).toBe(cashBefore);
    expect(accounts.totalShares("ACME")).toBe(sharesBefore);
  });

  it("holds invariants after a long random sequence", () => {
    accounts.open("carol", 500_00);
    accounts.credit("carol", "ACME", 200);

    const cashBefore = accounts.totalCash();
    const sharesBefore = accounts.totalShares("ACME");

    for (let i = 0; i < 200; i += 1) {
      const buy = makeOrder("alice", "buy", "limit", 100, 5);
      const sell = makeOrder("carol", "sell", "limit", 100, 5);

      try {
        accounts.reserve(buy);
        accounts.reserve(sell);
      } catch {
        break;
      }

      accounts.settle(makeTrade("alice", "carol", 100, 5));
      accounts.releaseBuyRemainder(buy, 100 * 5);
      accounts.assertInvariants();
    }

    expect(accounts.totalCash()).toBe(cashBefore);
    expect(accounts.totalShares("ACME")).toBe(sharesBefore);
  });

  it("rejects opening the same account twice", () => {
    expect(() => accounts.open("alice", 100)).toThrow();
  });

  it("rejects operations on an unknown account", () => {
    expect(() => accounts.get("nobody")).toThrow();
  });
});