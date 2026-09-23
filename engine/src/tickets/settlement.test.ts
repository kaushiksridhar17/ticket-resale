import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ExchangeState } from "../exchangeState.js";
import { DEMO_EVENT_ID, DEMO_SYMBOL, DEMO_TIER_ID, demoEvent } from "../testEvent.js";
import type { Order } from "../types.js";

describe("ticket settlement", () => {
  let dir: string;
  let logPath: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "exchange-tickets-"));
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

  function seeded(path: string | null = logPath): ExchangeState {
    const state = new ExchangeState(path);
    state.createEvent(demoEvent());
    state.issueTickets(DEMO_EVENT_ID, DEMO_TIER_ID, 10, "alice");
    return state;
  }

  it("gives the issuer every serial to begin with", () => {
    const state = seeded(null);

    expect(state.ticketsHeldBy("alice", DEMO_SYMBOL)).toHaveLength(10);
    expect(state.ticketsHeldBy("bob", DEMO_SYMBOL)).toEqual([]);
    state.assertInvariants();
    state.close();
  });

  it("moves serials to the buyer when a trade settles", () => {
    const state = seeded(null);

    submit(state, "alice", "sell", 6000, 3);
    submit(state, "bob", "buy", 6000, 3);

    const bob = state.ticketsHeldBy("bob", DEMO_SYMBOL);
    expect(bob.map((ticket) => ticket.serial)).toEqual([1, 2, 3]);
    expect(state.ticketsHeldBy("alice", DEMO_SYMBOL)).toHaveLength(7);
    state.assertInvariants();
    state.close();
  });

  it("moves only as many serials as the trade filled", () => {
    const state = seeded(null);

    submit(state, "alice", "sell", 6000, 5);
    submit(state, "bob", "buy", 6000, 2);

    expect(state.ticketsHeldBy("bob", DEMO_SYMBOL)).toHaveLength(2);
    expect(state.ticketsHeldBy("alice", DEMO_SYMBOL)).toHaveLength(8);
    state.assertInvariants();
    state.close();
  });

  it("bumps the rotation of a ticket each time it changes hands", () => {
    const state = seeded(null);

    submit(state, "alice", "sell", 6000, 1);
    submit(state, "bob", "buy", 6000, 1);

    const [afterFirst] = state.ticketsHeldBy("bob", DEMO_SYMBOL);
    expect(afterFirst!.rotation).toBe(1);

    submit(state, "bob", "sell", 6000, 1);
    submit(state, "carol", "buy", 6000, 1);

    const [afterSecond] = state.ticketsHeldBy("carol", DEMO_SYMBOL);
    expect(afterSecond!.id).toBe(afterFirst!.id);
    expect(afterSecond!.rotation).toBe(2);
    state.assertInvariants();
    state.close();
  });

  it("leaves serials in place while a sell order only rests", () => {
    const state = seeded(null);

    submit(state, "alice", "sell", 6000, 4);

    expect(state.ticketsHeldBy("alice", DEMO_SYMBOL)).toHaveLength(10);
    state.assertInvariants();
    state.close();
  });

  it("rebuilds the same holders and rotations from the log", () => {
    const first = seeded();
    submit(first, "alice", "sell", 6000, 4);
    submit(first, "bob", "buy", 6000, 4);
    submit(first, "bob", "sell", 5000, 2);
    submit(first, "carol", "buy", 5000, 2);
    const before = describeHolders(first);
    first.close();

    const second = new ExchangeState(logPath);
    expect(describeHolders(second)).toEqual(before);
    second.assertInvariants();
    second.close();
  });

  it("finds a ticket by its id", () => {
    const state = seeded(null);
    const [ticket] = state.ticketsHeldBy("alice", DEMO_SYMBOL);

    expect(state.getTicket(ticket!.id)?.holderId).toBe("alice");
    expect(state.getTicket("tkt_nope")).toBeNull();
    state.close();
  });
});

function describeHolders(state: ExchangeState): string[] {
  return ["alice", "bob", "carol"].map(
    (user) =>
      `${user}:${state
        .ticketsHeldBy(user, DEMO_SYMBOL)
        .map((ticket) => `${ticket.serial}/${ticket.rotation}`)
        .join(",")}`
  );
}
