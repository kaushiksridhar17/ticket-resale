import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { ExchangeState } from "../exchangeState.js";
import { OrderRejected } from "../exchange.js";
import { DEMO_EVENT_ID, DEMO_TIER_ID, demoEvent } from "../testEvent.js";
import { symbolFor } from "../events/types.js";
import type { Order, Side } from "../types.js";

const USERS = ["alice", "bob", "carol", "dave"];
const SYMBOL = symbolFor(DEMO_EVENT_ID, DEMO_TIER_ID);
const PER_USER = 25;

interface Action {
  userIndex: number;
  side: Side;
  priceInCents: number;
  quantity: number;
}

const actionArbitrary = fc.record({
  userIndex: fc.integer({ min: 0, max: USERS.length - 1 }),
  side: fc.constantFrom<Side>("buy", "sell"),
  priceInCents: fc.integer({ min: 1000, max: 6000 }),
  quantity: fc.integer({ min: 1, max: 8 }),
});

function run(actions: Action[]): ExchangeState {
  const state = new ExchangeState(null);
  state.createEvent(demoEvent({ perPersonLimit: 10_000 }));

  for (const user of USERS) {
    state.issueTickets(DEMO_EVENT_ID, DEMO_TIER_ID, PER_USER, user);
  }

  for (const action of actions) {
    const order: Order = {
      id: state.nextOrderId(),
      userId: USERS[action.userIndex]!,
      symbol: SYMBOL,
      side: action.side,
      type: "limit",
      priceInCents: action.priceInCents,
      quantity: action.quantity,
      remainingQuantity: action.quantity,
      status: "open",
      sequence: 0,
      createdAt: 1_700_000_000_000,
    };

    try {
      state.submitOrder(order);
    } catch (error) {
      if (!(error instanceof OrderRejected)) {
        throw error;
      }
    }
  }

  return state;
}

function fingerprint(state: ExchangeState): string {
  return USERS.map(
    (user) =>
      `${user}:${state
        .ticketsHeldBy(user, SYMBOL)
        .map((ticket) => `${ticket.serial}/${ticket.rotation}`)
        .join(",")}`
  ).join("|");
}

describe("ticket conservation", () => {
  it("never duplicates or loses a ticket", () => {
    fc.assert(
      fc.property(fc.array(actionArbitrary, { maxLength: 150 }), (actions) => {
        const state = run(actions);
        state.assertInvariants();

        const seen = new Set<string>();
        for (const user of [...USERS, "organizer"]) {
          for (const ticket of state.ticketsHeldBy(user, SYMBOL)) {
            expect(seen.has(ticket.id)).toBe(false);
            seen.add(ticket.id);
          }
        }

        expect(seen.size).toBe(PER_USER * USERS.length);
      }),
      { numRuns: 300 }
    );
  });

  it("gives every account exactly as many serials as it holds", () => {
    fc.assert(
      fc.property(fc.array(actionArbitrary, { maxLength: 150 }), (actions) => {
        const state = run(actions);

        for (const user of USERS) {
          expect(state.ticketsHeldBy(user, SYMBOL)).toHaveLength(
            state.heldTickets(user, SYMBOL)
          );
        }
      }),
      { numRuns: 300 }
    );
  });

  it("counts one rotation per hand-over and no more", () => {
    fc.assert(
      fc.property(fc.array(actionArbitrary, { maxLength: 150 }), (actions) => {
        const state = run(actions);

        let rotations = 0;
        for (const user of USERS) {
          for (const ticket of state.ticketsHeldBy(user, SYMBOL)) {
            rotations += ticket.rotation;
          }
        }

        const traded = state
          .recentTrades(SYMBOL, 5000)
          .reduce((total, trade) => total + trade.quantity, 0);

        expect(rotations).toBe(traded);
      }),
      { numRuns: 300 }
    );
  });

  it("assigns the same serials for the same sequence of orders", () => {
    fc.assert(
      fc.property(fc.array(actionArbitrary, { maxLength: 150 }), (actions) => {
        expect(fingerprint(run(actions))).toBe(fingerprint(run(actions)));
      }),
      { numRuns: 200 }
    );
  });
});
