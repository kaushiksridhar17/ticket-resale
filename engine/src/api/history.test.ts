import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildServer } from "../server.js";
import type { FastifyInstance } from "fastify";
import { DEMO_SYMBOL, seedEvent } from "../testEvent.js";
import { signUp } from "../testAuth.js";

describe("history routes without a database", () => {
  let app: FastifyInstance;
  let session: string;

  beforeEach(async () => {
    const built = await buildServer({
      logPath: null,
      authPepper: "test-pepper",
      admin: null,
    });
    app = built.app;
    seedEvent(built.state);
    await app.ready();

    session = await signUp(app, "alice@example.com", "customer");
  });

  afterEach(async () => {
    await app.close();
  });

  it("reports trade history as unavailable", async () => {
    const response = await app.inject({
      method: "GET",
      url: `/history/trades/${DEMO_SYMBOL}`,
    });

    expect(response.statusCode).toBe(503);
  });

  it("reports order history as unavailable", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/history/orders",
      cookies: { session },
    });

    expect(response.statusCode).toBe(503);
  });

  it("refuses order history without a session", async () => {
    const response = await app.inject({ method: "GET", url: "/history/orders" });

    expect(response.statusCode).toBe(401);
  });

  it("rejects an unknown symbol before checking the database", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/history/trades/NOPE",
    });

    expect(response.statusCode).toBe(404);
  });

  it("rejects a page size above the limit", async () => {
    const response = await app.inject({
      method: "GET",
      url: `/history/trades/${DEMO_SYMBOL}?limit=5000`,
    });

    expect(response.statusCode).toBe(400);
  });
});
