import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildServer } from "../server.js";
import type { FastifyInstance } from "fastify";

describe("history routes without a database", () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    const built = await buildServer({ logPath: null });
    app = built.app;
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it("reports trade history as unavailable", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/history/trades/ACME",
    });

    expect(response.statusCode).toBe(503);
  });

  it("reports order history as unavailable", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/history/orders/alice",
    });

    expect(response.statusCode).toBe(503);
  });

  it("reports candles as unavailable", async () => {
    const response = await app.inject({ method: "GET", url: "/candles/ACME" });

    expect(response.statusCode).toBe(503);
  });

  it("rejects an unknown symbol before checking the database", async () => {
    const trades = await app.inject({ method: "GET", url: "/history/trades/NOPE" });
    const bars = await app.inject({ method: "GET", url: "/candles/NOPE" });

    expect(trades.statusCode).toBe(404);
    expect(bars.statusCode).toBe(404);
  });

  it("rejects an unsupported candle interval", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/candles/ACME?interval=7",
    });

    expect(response.statusCode).toBe(400);
  });

  it("rejects a page size above the limit", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/history/trades/ACME?limit=5000",
    });

    expect(response.statusCode).toBe(400);
  });
});