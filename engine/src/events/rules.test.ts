import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ExchangeState } from "../exchangeState.js";
import { OrderRejected } from "../exchange.js";
import { DEMO_EVENT_ID, DEMO_SYMBOL, DEMO_TIER_ID, demoEvent } from "../testEvent.js";
import type { Order, Side } from "../types.js";

const SALES_CLOSE_AT = 2_000_000_000_000;

describe("ticket rules", () => {
  let dir: string;
  let logPath: string;
  let clock: number;
  let state: ExchangeState;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "tickets-"));
    logPath = join(dir, "events.jsonl");
    clock = SALES_CLOSE_AT - 60_000;
    state = new ExchangeState(logPath, { now: () => clock });
  });

  afterEach(() => {
    state.close();
    rmSync(dir, { recursive: true, force: true });
  });

  function openEvent(options: Parameters<typeof demoEvent>[0] = {}) {
    const event = demoEvent({
      faceValueInCents: 50_00,
      perPersonLimit: 4,
      salesCloseAt: SALES_CLOSE_AT,
      ...options,
    });
    state.createEvent(event);
    return event;
  }

  function order(
    userId: string,
    side: Side,
    priceInCents: number | null,
    quantity: number,
    type: "limit" | "market" = "limit",
    symbol = DEMO_SYMBOL
  ): Order {
    state.ensureAccount(userId);
    return {
      id: state.nextOrderId(),
      userId,
      symbol,
      side,
      type,
      priceInCents,
      quantity,
      remainingQuantity: quantity,
      status: "open",
      sequence: 0,
      createdAt: clock,
    };
  }

  it("rejects an order for a ticket type that does not exist", () => {
    openEvent();

    expect(() =>
      state.submitOrder(order("alice", "buy", 50_00, 1, "limit", "evt_nope:GA"))
    ).toThrow(OrderRejected);
  });

  it("rejects market orders, since tickets trade at a set price", () => {
    openEvent();

    expect(() =>
      state.submitOrder(order("alice", "buy", null, 1, "market"))
    ).toThrow(/set price/);
  });

  it("rejects a buy above face value", () => {
    openEvent();

    expect(() => state.submitOrder(order("alice", "buy", 50_01, 1))).toThrow(
      /above face value/
    );
  });

  it("rejects a listing above face value", () => {
    openEvent();
    state.issueTickets(DEMO_EVENT_ID, DEMO_TIER_ID, 2, "alice");

    expect(() => state.submitOrder(order("alice", "sell", 60_00, 1))).toThrow(
      /above face value/
    );
  });

  it("accepts a price at face value", () => {
    openEvent();

    const result = state.submitOrder(order("alice", "buy", 50_00, 1));

    expect(result.order.status).toBe("open");
  });

  it("accepts a price below face value", () => {
    openEvent();
    state.issueTickets(DEMO_EVENT_ID, DEMO_TIER_ID, 1, "alice");

    const result = state.submitOrder(order("alice", "sell", 40_00, 1));

    expect(result.order.status).toBe("open");
  });

  it("supports a free event priced at zero", () => {
    openEvent({ eventId: "evt_free", faceValueInCents: 0, paymentMode: "none" });
    state.issueTickets("evt_free", DEMO_TIER_ID, 1, "alice");

    const listing = state.submitOrder(
      order("alice", "sell", 0, 1, "limit", "evt_free:GA")
    );
    expect(listing.order.status).toBe("open");

    const bought = state.submitOrder(
      order("bob", "buy", 0, 1, "limit", "evt_free:GA")
    );

    expect(bought.trades).toHaveLength(1);
    expect(bought.trades[0]?.priceInCents).toBe(0);
    expect(state.heldTickets("bob", "evt_free:GA")).toBe(1);
  });

  it("rejects a single order beyond the per person limit", () => {
    openEvent();

    expect(() => state.submitOrder(order("alice", "buy", 50_00, 5))).toThrow(
      /at most 4 tickets/
    );
  });

  it("counts tickets already held towards the limit", () => {
    openEvent();
    state.issueTickets(DEMO_EVENT_ID, DEMO_TIER_ID, 3, "alice");

    expect(() => state.submitOrder(order("alice", "buy", 50_00, 2))).toThrow(
      /at most 4 tickets/
    );
    expect(state.submitOrder(order("alice", "buy", 50_00, 1)).order.status).toBe(
      "open"
    );
  });

  it("counts waitlist orders already placed towards the limit", () => {
    openEvent();
    state.submitOrder(order("alice", "buy", 50_00, 3));

    expect(() => state.submitOrder(order("alice", "buy", 50_00, 2))).toThrow(
      /at most 4 tickets/
    );
  });

  it("frees the limit again when a waitlist order is cancelled", () => {
    openEvent();
    const placed = state.submitOrder(order("alice", "buy", 50_00, 4));
    state.cancelOrder(DEMO_SYMBOL, placed.order.id);

    expect(state.submitOrder(order("alice", "buy", 50_00, 4)).order.status).toBe(
      "open"
    );
  });

  it("does not apply the buy limit to listings", () => {
    openEvent();
    state.issueTickets(DEMO_EVENT_ID, DEMO_TIER_ID, 50, "organizer");

    const listed = state.submitOrder(order("organizer", "sell", 50_00, 50));

    expect(listed.order.status).toBe("open");
  });

  it("rejects orders once the sales cutoff has passed", () => {
    openEvent();
    clock = SALES_CLOSE_AT + 1;

    expect(() => state.submitOrder(order("alice", "buy", 50_00, 1))).toThrow(
      /closed/
    );
  });

  it("rejects orders once sales are closed by hand", () => {
    openEvent();
    state.closeSales(DEMO_EVENT_ID);

    expect(() => state.submitOrder(order("alice", "buy", 50_00, 1))).toThrow(
      /closed/
    );
  });

  it("cancels every resting order when sales close", () => {
    openEvent();
    state.issueTickets(DEMO_EVENT_ID, DEMO_TIER_ID, 10, "organizer");
    state.submitOrder(order("organizer", "sell", 50_00, 10));
    state.submitOrder(order("alice", "buy", 40_00, 2));

    state.closeSales(DEMO_EVENT_ID);

    const book = state.exchange.engine.snapshot(DEMO_SYMBOL);
    expect(book.asks).toHaveLength(0);
    expect(book.bids).toHaveLength(0);
    expect(state.restingQuantity(DEMO_SYMBOL, "buy")).toBe(0);
  });

  it("stops trading and clears the book when an event is cancelled", () => {
    openEvent();
    state.issueTickets(DEMO_EVENT_ID, DEMO_TIER_ID, 10, "organizer");
    state.submitOrder(order("organizer", "sell", 50_00, 10));

    state.cancelEvent(DEMO_EVENT_ID);

    expect(state.exchange.engine.snapshot(DEMO_SYMBOL).asks).toHaveLength(0);
    expect(() => state.submitOrder(order("alice", "buy", 50_00, 1))).toThrow(
      /cancelled/
    );
  });

  it("gives issued tickets to the organiser by default", () => {
    const event = openEvent();
    state.issueTickets(DEMO_EVENT_ID, DEMO_TIER_ID, 200);

    expect(state.heldTickets(event.organizerId, DEMO_SYMBOL)).toBe(200);
    expect(state.events.issuedCount(DEMO_SYMBOL)).toBe(200);
  });

  it("refuses to issue tickets for a tier that does not exist", () => {
    openEvent();

    expect(() => state.issueTickets(DEMO_EVENT_ID, "VIP", 10)).toThrow(
      OrderRejected
    );
  });

  it("runs the initial sale through the same book as resale", () => {
    const event = openEvent();
    state.issueTickets(DEMO_EVENT_ID, DEMO_TIER_ID, 3);
    state.submitOrder(order(event.organizerId, "sell", 50_00, 3));

    const bought = state.submitOrder(order("alice", "buy", 50_00, 2));

    expect(bought.trades).toHaveLength(1);
    expect(state.heldTickets("alice", DEMO_SYMBOL)).toBe(2);
    expect(state.heldTickets(event.organizerId, DEMO_SYMBOL)).toBe(1);
  });

  it("puts a buyer who misses out on the waitlist, in order", () => {
    const event = openEvent();
    state.issueTickets(DEMO_EVENT_ID, DEMO_TIER_ID, 1);
    state.submitOrder(order(event.organizerId, "sell", 50_00, 1));

    state.submitOrder(order("alice", "buy", 50_00, 1));
    const second = state.submitOrder(order("bob", "buy", 50_00, 1));
    const third = state.submitOrder(order("carol", "buy", 50_00, 1));

    expect(state.heldTickets("alice", DEMO_SYMBOL)).toBe(1);
    expect(second.order.status).toBe("open");
    expect(third.order.status).toBe("open");

    state.submitOrder(order("alice", "sell", 50_00, 1));

    expect(state.heldTickets("bob", DEMO_SYMBOL)).toBe(1);
    expect(state.heldTickets("carol", DEMO_SYMBOL)).toBe(0);
  });

  it("refuses to sell tickets the holder does not have", () => {
    openEvent();
    state.issueTickets(DEMO_EVENT_ID, DEMO_TIER_ID, 1, "alice");

    expect(() => state.submitOrder(order("alice", "sell", 50_00, 2))).toThrow(
      OrderRejected
    );
  });

  it("refuses to list the same ticket twice", () => {
    openEvent();
    state.issueTickets(DEMO_EVENT_ID, DEMO_TIER_ID, 1, "alice");
    state.submitOrder(order("alice", "sell", 50_00, 1));

    expect(() => state.submitOrder(order("alice", "sell", 50_00, 1))).toThrow(
      OrderRejected
    );
  });
});
