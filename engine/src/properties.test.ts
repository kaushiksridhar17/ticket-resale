import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { Exchange, OrderRejected } from "./exchange.js";
import type { Order, OrderType, Side } from "./types.js";

const USERS = ["alice", "bob", "carol", "dave"];
const STARTING_CASH = 1_000_00;
const STARTING_SHARES = 500;

interface Action {
  userIndex: number;
  side: Side;
  type: OrderType;
  priceInCents: number;
  quantity: number;
  cancelIndex: number | null;
}

const actionArbitrary = fc.record({
  userIndex: fc.integer({ min: 0, max: USERS.length - 1 }),
  side: fc.constantFrom<Side>("buy", "sell"),
  type: fc.constantFrom<OrderType>("limit", "limit", "limit", "market"),
  priceInCents: fc.integer({ min: 90, max: 110 }),
  quantity: fc.integer({ min: 1, max: 40 }),
  cancelIndex: fc.option(fc.integer({ min: 0, max: 50 }), { nil: null }),
});

function freshExchange(): Exchange {
  const exchange = new Exchange();
  for (const user of USERS) {
    exchange.accounts.open(user, STARTING_CASH);
    exchange.accounts.credit(user, "ACME", STARTING_SHARES);
  }
  return exchange;
}

function buildOrder(action: Action, index: number): Order {
  const isMarket = action.type === "market";
  const quantity = action.quantity;

  return {
    id: `ord_${index}`,
    userId: USERS[action.userIndex]!,
    symbol: "ACME",
    side: action.side,
    type: action.type,
    priceInCents: isMarket ? null : action.priceInCents,
    maxNotionalInCents:
      isMarket && action.side === "buy" ? quantity * 110 : null,
    quantity,
    remainingQuantity: quantity,
    status: "open",
    sequence: 0,
    createdAt: 1_700_000_000_000 + index,
  };
}

function run(actions: Action[]): {
  exchange: Exchange;
  submitted: Order[];
  fillsByOrderId: Map<string, number>;
} {
  const exchange = freshExchange();
  const submitted: Order[] = [];
  const restingIds: string[] = [];
  const fillsByOrderId = new Map<string, number>();

  actions.forEach((action, index) => {
    if (action.cancelIndex !== null && restingIds.length > 0) {
      const target = restingIds[action.cancelIndex % restingIds.length]!;
      exchange.cancel("ACME", target);
      return;
    }

    const order = buildOrder(action, index);

    try {
      const result = exchange.submit(order);
      submitted.push(result.order);

      for (const trade of result.trades) {
        const buyFilled = fillsByOrderId.get(trade.buyOrderId) ?? 0;
        fillsByOrderId.set(trade.buyOrderId, buyFilled + trade.quantity);
        const sellFilled = fillsByOrderId.get(trade.sellOrderId) ?? 0;
        fillsByOrderId.set(trade.sellOrderId, sellFilled + trade.quantity);
      }

      if (result.order.status === "open" || result.order.status === "partially_filled") {
        restingIds.push(result.order.id);
      }
    } catch (error) {
      if (!(error instanceof OrderRejected)) {
        throw error;
      }
    }
  });

  return { exchange, submitted, fillsByOrderId };
}

describe("exchange properties", () => {
  it("never creates or destroys cash", () => {
    fc.assert(
      fc.property(fc.array(actionArbitrary, { maxLength: 200 }), (actions) => {
        const { exchange } = run(actions);
        expect(exchange.accounts.totalCash()).toBe(
          STARTING_CASH * USERS.length
        );
      }),
      { numRuns: 500 }
    );
  });

  it("never creates or destroys shares", () => {
    fc.assert(
      fc.property(fc.array(actionArbitrary, { maxLength: 200 }), (actions) => {
        const { exchange } = run(actions);
        expect(exchange.accounts.totalShares("ACME")).toBe(
          STARTING_SHARES * USERS.length
        );
      }),
      { numRuns: 500 }
    );
  });

  it("never lets an account go negative or over-lock", () => {
    fc.assert(
      fc.property(fc.array(actionArbitrary, { maxLength: 200 }), (actions) => {
        const { exchange } = run(actions);
        exchange.accounts.assertInvariants();
      }),
      { numRuns: 500 }
    );
  });

  it("conserves quantity within every order", () => {
    fc.assert(
      fc.property(fc.array(actionArbitrary, { maxLength: 200 }), (actions) => {
        const { submitted, fillsByOrderId } = run(actions);

        for (const order of submitted) {
          const filled = fillsByOrderId.get(order.id) ?? 0;
          expect(filled + order.remainingQuantity).toBe(order.quantity);
        }
      }),
      { numRuns: 500 }
    );
  });

  it("produces the same state for the same sequence of actions", () => {
    fc.assert(
      fc.property(fc.array(actionArbitrary, { maxLength: 200 }), (actions) => {
        const first = run(actions);
        const second = run(actions);

        expect(second.exchange.engine.digest()).toBe(
          first.exchange.engine.digest()
        );
        expect(second.exchange.accounts.totalCash()).toBe(
          first.exchange.accounts.totalCash()
        );
      }),
      { numRuns: 300 }
    );
  });

  it("never fills a buy above its limit price", () => {
    fc.assert(
      fc.property(fc.array(actionArbitrary, { maxLength: 200 }), (actions) => {
        const exchange = freshExchange();

        actions.forEach((action, index) => {
          const order = buildOrder(action, index);
          try {
            const result = exchange.submit(order);
            for (const trade of result.trades) {
              if (order.side === "buy" && order.priceInCents !== null) {
                expect(trade.priceInCents).toBeLessThanOrEqual(
                  order.priceInCents
                );
              }
              if (order.side === "sell" && order.priceInCents !== null) {
                expect(trade.priceInCents).toBeGreaterThanOrEqual(
                  order.priceInCents
                );
              }
            }
          } catch (error) {
            if (!(error instanceof OrderRejected)) {
              throw error;
            }
          }
        });
      }),
      { numRuns: 300 }
    );
  });

  it("never matches a user against themselves", () => {
    fc.assert(
      fc.property(fc.array(actionArbitrary, { maxLength: 200 }), (actions) => {
        const exchange = freshExchange();

        actions.forEach((action, index) => {
          try {
            const result = exchange.submit(buildOrder(action, index));
            for (const trade of result.trades) {
              expect(trade.buyUserId).not.toBe(trade.sellUserId);
            }
          } catch (error) {
            if (!(error instanceof OrderRejected)) {
              throw error;
            }
          }
        });
      }),
      { numRuns: 300 }
    );
  });
});