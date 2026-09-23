import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildServer } from "../server.js";
import type { FastifyInstance } from "fastify";

describe("HTTP API", () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    const built = await buildServer({ logPath: null });
    app = built.app;
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  async function placeOrder(body: Record<string, unknown>) {
    return app.inject({ method: "POST", url: "/orders", payload: body });
  }

  it("reports health", async () => {
    const response = await app.inject({ method: "GET", url: "/health" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: "ok" });
  });

  it("lists the available symbols", async () => {
    const response = await app.inject({ method: "GET", url: "/symbols" });

    expect(response.json().symbols).toContain("ACME");
  });

  it("returns an empty book for a fresh symbol", async () => {
    const response = await app.inject({ method: "GET", url: "/book/ACME" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ symbol: "ACME", bids: [], asks: [] });
  });

  it("rejects an unknown symbol", async () => {
    const response = await app.inject({ method: "GET", url: "/book/NOPE" });

    expect(response.statusCode).toBe(404);
  });

  it("creates an account on first contact", async () => {
    const response = await app.inject({ method: "GET", url: "/account/alice" });

    expect(response.statusCode).toBe(200);
    expect(response.json().cash.total).toBeGreaterThan(0);
    expect(response.json().positions.length).toBeGreaterThan(0);
  });

  it("rests a limit order and shows it in the book", async () => {
    const response = await placeOrder({
      userId: "alice",
      symbol: "ACME",
      side: "sell",
      type: "limit",
      priceInCents: 5050,
      quantity: 100,
    });

    expect(response.statusCode).toBe(201);
    expect(response.json().order.status).toBe("open");

    const book = await app.inject({ method: "GET", url: "/book/ACME" });
    expect(book.json().asks[0]).toMatchObject({
      priceInCents: 5050,
      totalQuantity: 100,
    });
  });

  it("executes at the resting price, not the incoming price", async () => {
    await placeOrder({
      userId: "alice",
      symbol: "ACME",
      side: "sell",
      type: "limit",
      priceInCents: 5050,
      quantity: 100,
    });

    const response = await placeOrder({
      userId: "bob",
      symbol: "ACME",
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
    await placeOrder({
      userId: "alice",
      symbol: "ACME",
      side: "sell",
      type: "limit",
      priceInCents: 5050,
      quantity: 100,
    });
    await placeOrder({
      userId: "bob",
      symbol: "ACME",
      side: "buy",
      type: "limit",
      priceInCents: 5100,
      quantity: 60,
    });

    const bob = await app.inject({ method: "GET", url: "/account/bob" });
    const position = bob
      .json()
      .positions.find((p: { symbol: string }) => p.symbol === "ACME");

    expect(position.total).toBe(1060);
    expect(bob.json().cash.locked).toBe(0);
  });

  it("rejects a malformed body", async () => {
    const response = await placeOrder({
      userId: "alice",
      symbol: "ACME",
      side: "sideways",
      type: "limit",
      priceInCents: 5050,
      quantity: 100,
    });

    expect(response.statusCode).toBe(400);
  });

  it("rejects a limit order with no price", async () => {
    const response = await placeOrder({
      userId: "alice",
      symbol: "ACME",
      side: "buy",
      type: "limit",
      quantity: 10,
    });

    expect(response.statusCode).toBe(400);
  });

  it("rejects a market order that carries a price", async () => {
    const response = await placeOrder({
      userId: "alice",
      symbol: "ACME",
      side: "buy",
      type: "market",
      priceInCents: 5050,
      quantity: 10,
    });

    expect(response.statusCode).toBe(400);
  });

  it("returns 422 when the exchange refuses the order", async () => {
    const response = await placeOrder({
      userId: "carol",
      symbol: "ACME",
      side: "buy",
      type: "limit",
      priceInCents: 5000,
      quantity: 5000,
    });

    expect(response.statusCode).toBe(422);
    expect(response.json().error).toContain("available");
  });

  it("cancels a resting order and frees the funds", async () => {
    const placed = await placeOrder({
      userId: "alice",
      symbol: "ACME",
      side: "buy",
      type: "limit",
      priceInCents: 5000,
      quantity: 10,
    });
    const orderId = placed.json().order.id;

    const before = await app.inject({ method: "GET", url: "/account/alice" });
    expect(before.json().cash.locked).toBe(50_000);

    const cancelled = await app.inject({
      method: "DELETE",
      url: `/orders/${orderId}`,
    });

    expect(cancelled.statusCode).toBe(200);
    expect(cancelled.json().order.status).toBe("cancelled");

    const after = await app.inject({ method: "GET", url: "/account/alice" });
    expect(after.json().cash.locked).toBe(0);
    expect(after.json().positions.length).toBeGreaterThan(0);
  });

  it("returns 404 when cancelling an unknown order", async () => {
    const response = await app.inject({
      method: "DELETE",
      url: "/orders/ord_does_not_exist",
    });

    expect(response.statusCode).toBe(404);
  });

  it("returns 409 when cancelling an order that already filled", async () => {
    await placeOrder({
      userId: "alice",
      symbol: "ACME",
      side: "sell",
      type: "limit",
      priceInCents: 5050,
      quantity: 10,
    });
    const filled = await placeOrder({
      userId: "bob",
      symbol: "ACME",
      side: "buy",
      type: "limit",
      priceInCents: 5050,
      quantity: 10,
    });

    const response = await app.inject({
      method: "DELETE",
      url: `/orders/${filled.json().order.id}`,
    });

    expect(response.statusCode).toBe(409);
  });

  it("records executed trades for the symbol", async () => {
    await placeOrder({
      userId: "alice",
      symbol: "ACME",
      side: "sell",
      type: "limit",
      priceInCents: 5050,
      quantity: 100,
    });
    await placeOrder({
      userId: "bob",
      symbol: "ACME",
      side: "buy",
      type: "limit",
      priceInCents: 5100,
      quantity: 60,
    });

    const response = await app.inject({ method: "GET", url: "/trades/ACME" });

    expect(response.json().trades).toHaveLength(1);
    expect(response.json().trades[0].quantity).toBe(60);
  });

  it("keeps symbols independent", async () => {
    await placeOrder({
      userId: "alice",
      symbol: "ACME",
      side: "sell",
      type: "limit",
      priceInCents: 5050,
      quantity: 100,
    });

    const zenx = await app.inject({ method: "GET", url: "/book/ZENX" });
    expect(zenx.json().asks).toHaveLength(0);
  });
});