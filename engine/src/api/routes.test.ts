import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildServer } from "../server.js";
import type { FastifyInstance } from "fastify";
import { ExchangeState } from "../exchangeState.js";
import { DEMO_SYMBOL, seedEvent } from "../testEvent.js";
import { signUp, userIdFor } from "../testAuth.js";

const OTHER_SYMBOL = "evt_other:GA";

describe("HTTP API", () => {
  let app: FastifyInstance;
  let alice: string;
  let bob: string;
  let state: ExchangeState;
  let aliceId: string;
  let bobId: string;

  beforeEach(async () => {
    const built = await buildServer({
      logPath: null,
      authPepper: "test-pepper",
      admin: null,
    });
    app = built.app;
    state = built.state;
    await app.ready();

    alice = await signUp(app, "alice@example.com", "customer");
    bob = await signUp(app, "bob@example.com", "customer");
    aliceId = await userIdFor(app, alice);
    bobId = await userIdFor(app, bob);

    seedEvent(state, { issueTo: [aliceId, bobId], count: 1000 });
    seedEvent(state, { eventId: "evt_other" });
  });

  afterEach(async () => {
    await app.close();
  });

  async function placeOrder(session: string, body: Record<string, unknown>) {
    return app.inject({
      method: "POST",
      url: "/orders",
      payload: body,
      cookies: { session },
    });
  }

  it("reports health without a session", async () => {
    const response = await app.inject({ method: "GET", url: "/health" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: "ok" });
  });

  it("lists the available symbols", async () => {
    const response = await app.inject({ method: "GET", url: "/symbols" });

    expect(response.json().symbols).toContain(DEMO_SYMBOL);
  });

  it("returns an empty book for a fresh symbol", async () => {
    const response = await app.inject({ method: "GET", url: `/book/${DEMO_SYMBOL}` });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ symbol: DEMO_SYMBOL, bids: [], asks: [] });
  });

  it("rejects an unknown symbol", async () => {
    const response = await app.inject({ method: "GET", url: "/book/NOPE" });

    expect(response.statusCode).toBe(404);
  });

  it("refuses to show an account without a session", async () => {
    const response = await app.inject({ method: "GET", url: "/account" });

    expect(response.statusCode).toBe(401);
  });

  it("creates the account on first look", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/account",
      cookies: { session: alice },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().userId).toMatch(/^usr_/);
    expect(response.json().positions.length).toBeGreaterThan(0);
  });

  it("refuses to place an order without a session", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/orders",
      payload: {
        symbol: DEMO_SYMBOL,
        side: "sell",
        type: "limit",
        priceInCents: 5050,
        quantity: 100,
      },
    });

    expect(response.statusCode).toBe(401);
  });

  it("ignores a userId in the body and uses the session", async () => {
    const placed = await placeOrder(alice, {
      userId: "somebody_else",
      symbol: DEMO_SYMBOL,
      side: "sell",
      type: "limit",
      priceInCents: 5050,
      quantity: 100,
    });

    expect(placed.statusCode).toBe(201);

    const account = await app.inject({
      method: "GET",
      url: "/account",
      cookies: { session: alice },
    });
    expect(account.json().orders).toHaveLength(1);
    expect(placed.json().order.userId).toBe(account.json().userId);
  });

  it("rests a limit order and shows it in the book", async () => {
    const response = await placeOrder(alice, {
      symbol: DEMO_SYMBOL,
      side: "sell",
      type: "limit",
      priceInCents: 5050,
      quantity: 100,
    });

    expect(response.statusCode).toBe(201);
    expect(response.json().order.status).toBe("open");

    const book = await app.inject({ method: "GET", url: `/book/${DEMO_SYMBOL}` });
    expect(book.json().asks[0]).toMatchObject({
      priceInCents: 5050,
      totalQuantity: 100,
    });
  });

  it("executes at the resting price, not the incoming price", async () => {
    await placeOrder(alice, {
      symbol: DEMO_SYMBOL,
      side: "sell",
      type: "limit",
      priceInCents: 5050,
      quantity: 100,
    });

    const response = await placeOrder(bob, {
      symbol: DEMO_SYMBOL,
      side: "buy",
      type: "limit",
      priceInCents: 5100,
      quantity: 60,
    });

    const trades = response.json().trades;
    expect(trades).toHaveLength(1);
    expect(trades[0].priceInCents).toBe(5050);
  });

  it("settles balances through the API", async () => {
    await placeOrder(alice, {
      symbol: DEMO_SYMBOL,
      side: "sell",
      type: "limit",
      priceInCents: 5050,
      quantity: 100,
    });
    await placeOrder(bob, {
      symbol: DEMO_SYMBOL,
      side: "buy",
      type: "limit",
      priceInCents: 5100,
      quantity: 60,
    });

    const account = await app.inject({
      method: "GET",
      url: "/account",
      cookies: { session: bob },
    });
    const position = account
      .json()
      .positions.find((p: { symbol: string }) => p.symbol === DEMO_SYMBOL);

    expect(position.total).toBe(1060);
    expect(position.locked).toBe(0);
  });

  it("rejects a malformed body", async () => {
    const response = await placeOrder(alice, {
      symbol: DEMO_SYMBOL,
      side: "sideways",
      type: "limit",
      priceInCents: 5050,
      quantity: 100,
    });

    expect(response.statusCode).toBe(400);
  });

  it("rejects a limit order with no price", async () => {
    const response = await placeOrder(alice, {
      symbol: DEMO_SYMBOL,
      side: "buy",
      type: "limit",
      quantity: 10,
    });

    expect(response.statusCode).toBe(400);
  });

  it("rejects a market order that carries a price", async () => {
    const response = await placeOrder(alice, {
      symbol: DEMO_SYMBOL,
      side: "buy",
      type: "market",
      priceInCents: 5050,
      quantity: 10,
    });

    expect(response.statusCode).toBe(400);
  });

  it("returns 422 when the exchange refuses the order", async () => {
    const response = await placeOrder(alice, {
      symbol: DEMO_SYMBOL,
      side: "sell",
      type: "limit",
      priceInCents: 5000,
      quantity: 5000,
    });

    expect(response.statusCode).toBe(422);
    expect(response.json().error).toContain("free");
  });

  it("cancels a resting offer and gives the tickets back", async () => {
    const placed = await placeOrder(alice, {
      symbol: DEMO_SYMBOL,
      side: "sell",
      type: "limit",
      priceInCents: 5000,
      quantity: 10,
    });
    const orderId = placed.json().order.id;

    const locked = async () => {
      const account = await app.inject({
        method: "GET",
        url: "/account",
        cookies: { session: alice },
      });
      return account
        .json()
        .positions.find((p: { symbol: string }) => p.symbol === DEMO_SYMBOL)
        .locked;
    };

    expect(await locked()).toBe(10);

    const cancelled = await app.inject({
      method: "DELETE",
      url: `/orders/${orderId}`,
      cookies: { session: alice },
    });

    expect(cancelled.statusCode).toBe(200);
    expect(cancelled.json().order.status).toBe("cancelled");
    expect(await locked()).toBe(0);
  });

  it("refuses to cancel an order belonging to somebody else", async () => {
    const placed = await placeOrder(alice, {
      symbol: DEMO_SYMBOL,
      side: "buy",
      type: "limit",
      priceInCents: 5000,
      quantity: 10,
    });
    const orderId = placed.json().order.id;

    const response = await app.inject({
      method: "DELETE",
      url: `/orders/${orderId}`,
      cookies: { session: bob },
    });

    expect(response.statusCode).toBe(403);

    const book = await app.inject({ method: "GET", url: `/book/${DEMO_SYMBOL}` });
    expect(book.json().bids[0]?.totalQuantity).toBe(10);
  });

  it("refuses to cancel without a session", async () => {
    const placed = await placeOrder(alice, {
      symbol: DEMO_SYMBOL,
      side: "buy",
      type: "limit",
      priceInCents: 5000,
      quantity: 10,
    });

    const response = await app.inject({
      method: "DELETE",
      url: `/orders/${placed.json().order.id}`,
    });

    expect(response.statusCode).toBe(401);
  });

  it("returns 404 when cancelling an unknown order", async () => {
    const response = await app.inject({
      method: "DELETE",
      url: "/orders/ord_does_not_exist",
      cookies: { session: alice },
    });

    expect(response.statusCode).toBe(404);
  });

  it("returns 409 when cancelling an order that already filled", async () => {
    await placeOrder(alice, {
      symbol: DEMO_SYMBOL,
      side: "sell",
      type: "limit",
      priceInCents: 5050,
      quantity: 10,
    });
    const filled = await placeOrder(bob, {
      symbol: DEMO_SYMBOL,
      side: "buy",
      type: "limit",
      priceInCents: 5050,
      quantity: 10,
    });

    const response = await app.inject({
      method: "DELETE",
      url: `/orders/${filled.json().order.id}`,
      cookies: { session: bob },
    });

    expect(response.statusCode).toBe(409);
  });

  it("records executed trades for the symbol", async () => {
    await placeOrder(alice, {
      symbol: DEMO_SYMBOL,
      side: "sell",
      type: "limit",
      priceInCents: 5050,
      quantity: 100,
    });
    await placeOrder(bob, {
      symbol: DEMO_SYMBOL,
      side: "buy",
      type: "limit",
      priceInCents: 5100,
      quantity: 60,
    });

    const response = await app.inject({ method: "GET", url: `/trades/${DEMO_SYMBOL}` });

    expect(response.json().trades).toHaveLength(1);
    expect(response.json().trades[0].quantity).toBe(60);
  });

  it("keeps symbols independent", async () => {
    await placeOrder(alice, {
      symbol: DEMO_SYMBOL,
      side: "sell",
      type: "limit",
      priceInCents: 5050,
      quantity: 100,
    });

    const other = await app.inject({ method: "GET", url: `/book/${OTHER_SYMBOL}` });
    expect(other.json().asks).toHaveLength(0);
  });
});
