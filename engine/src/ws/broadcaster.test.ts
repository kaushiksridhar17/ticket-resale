import { afterEach, beforeEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { buildServer } from "../server.js";
import type { FastifyInstance } from "fastify";
import { ExchangeState } from "../exchangeState.js";
import { DEMO_EVENT_ID, DEMO_SYMBOL, DEMO_TIER_ID, seedEvent } from "../testEvent.js";
import { signUp, userIdFor } from "../testAuth.js";

const OTHER_SYMBOL = "evt_other:GA";

interface Message {
  type: string;
  symbol?: string;
  book?: { bids: unknown[]; asks: unknown[] };
  trades?: { quantity: number; priceInCents: number }[];
  error?: string;
}

describe("WebSocket broadcasting", () => {
  let app: FastifyInstance;
  let state: ExchangeState;
  let url: string;
  const sockets: WebSocket[] = [];
  const sessions = new Map<string, string>();

  beforeEach(async () => {
    sessions.clear();
    const built = await buildServer({
      logPath: null,
      broadcastIntervalMs: 20,
      authPepper: "test-pepper",
      admin: null,
    });
    app = built.app;
    state = built.state;
    seedEvent(state);
    seedEvent(state, { eventId: "evt_other" });
    await app.listen({ port: 0, host: "127.0.0.1" });

    const address = app.server.address();
    if (typeof address === "string" || address === null) {
      throw new Error("Expected a TCP address");
    }
    url = `ws://127.0.0.1:${address.port}/ws`;
  });

  afterEach(async () => {
    for (const socket of sockets) {
      socket.close();
    }
    sockets.length = 0;
    await app.close();
  });

  function connect(): Promise<WebSocket> {
    const socket = new WebSocket(url);
    sockets.push(socket);
    return new Promise((resolve, reject) => {
      socket.once("open", () => resolve(socket));
      socket.once("error", reject);
    });
  }

  function nextMessage(
    socket: WebSocket,
    predicate: (message: Message) => boolean,
    timeoutMs = 2000
  ): Promise<Message> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        socket.off("message", handler);
        reject(new Error("Timed out waiting for message"));
      }, timeoutMs);

      function handler(raw: Buffer) {
        const message = JSON.parse(raw.toString()) as Message;
        if (predicate(message)) {
          clearTimeout(timer);
          socket.off("message", handler);
          resolve(message);
        }
      }

      socket.on("message", handler);
    });
  }

  async function sessionFor(userId: string): Promise<string> {
    const existing = sessions.get(userId);
    if (existing) {
      return existing;
    }
    const token = await signUp(app, `${userId}@example.com`);
    state.issueTickets(
      DEMO_EVENT_ID,
      DEMO_TIER_ID,
      1000,
      await userIdFor(app, token)
    );

    sessions.set(userId, token);
    return token;
  }

  async function placeOrder(body: Record<string, unknown>) {
    const { userId, ...rest } = body as { userId: string } & Record<string, unknown>;
    const session = await sessionFor(userId);
    return app.inject({
      method: "POST",
      url: "/orders",
      payload: rest,
      cookies: { session },
    });
  }

  it("sends a book snapshot on subscribe", async () => {
    const socket = await connect();
    const received = nextMessage(socket, (m) => m.type === "book");

    socket.send(JSON.stringify({ type: "subscribe", symbol: DEMO_SYMBOL }));

    const message = await received;
    expect(message.symbol).toBe(DEMO_SYMBOL);
    expect(message.book?.bids).toEqual([]);
    expect(message.book?.asks).toEqual([]);
  });

  it("rejects a subscription to an unknown symbol", async () => {
    const socket = await connect();
    const received = nextMessage(socket, (m) => m.type === "error");

    socket.send(JSON.stringify({ type: "subscribe", symbol: "NOPE" }));

    const message = await received;
    expect(message.error).toContain("NOPE");
  });

  it("replies to a ping", async () => {
    const socket = await connect();
    const received = nextMessage(socket, (m) => m.type === "pong");

    socket.send(JSON.stringify({ type: "ping" }));

    await expect(received).resolves.toMatchObject({ type: "pong" });
  });

  it("reports invalid JSON", async () => {
    const socket = await connect();
    const received = nextMessage(socket, (m) => m.type === "error");

    socket.send("not json at all");

    const message = await received;
    expect(message.error).toContain("JSON");
  });

  it("pushes an updated book when an order rests", async () => {
    const socket = await connect();
    await nextMessage(
      socket,
      (m) => m.type === "book",
      2000
    ).catch(() => undefined);

    socket.send(JSON.stringify({ type: "subscribe", symbol: DEMO_SYMBOL }));
    await nextMessage(socket, (m) => m.type === "book");

    const updated = nextMessage(
      socket,
      (m) => m.type === "book" && (m.book?.asks.length ?? 0) > 0
    );

    await placeOrder({
      userId: "alice",
      symbol: DEMO_SYMBOL,
      side: "sell",
      type: "limit",
      priceInCents: 5050,
      quantity: 100,
    });

    const message = await updated;
    expect(message.book?.asks).toHaveLength(1);
  });

  it("pushes trades when orders cross", async () => {
    const socket = await connect();
    socket.send(JSON.stringify({ type: "subscribe", symbol: DEMO_SYMBOL }));
    await nextMessage(socket, (m) => m.type === "book");

    await placeOrder({
      userId: "alice",
      symbol: DEMO_SYMBOL,
      side: "sell",
      type: "limit",
      priceInCents: 5050,
      quantity: 100,
    });

    const received = nextMessage(socket, (m) => m.type === "trades");

    await placeOrder({
      userId: "bob",
      symbol: DEMO_SYMBOL,
      side: "buy",
      type: "limit",
      priceInCents: 5100,
      quantity: 60,
    });

    const message = await received;
    expect(message.trades).toHaveLength(1);
    expect(message.trades?.[0]?.priceInCents).toBe(5050);
    expect(message.trades?.[0]?.quantity).toBe(60);
  });

  it("does not send updates for symbols a client did not subscribe to", async () => {
    const socket = await connect();
    socket.send(JSON.stringify({ type: "subscribe", symbol: OTHER_SYMBOL }));
    await nextMessage(socket, (m) => m.type === "book");

    const wrongSymbol = nextMessage(
      socket,
      (m) => m.symbol === DEMO_SYMBOL,
      400
    );

    await placeOrder({
      userId: "alice",
      symbol: DEMO_SYMBOL,
      side: "sell",
      type: "limit",
      priceInCents: 5050,
      quantity: 100,
    });

    await expect(wrongSymbol).rejects.toThrow("Timed out");
  });

  it("stops sending after unsubscribe", async () => {
    const socket = await connect();
    socket.send(JSON.stringify({ type: "subscribe", symbol: DEMO_SYMBOL }));
    await nextMessage(socket, (m) => m.type === "book");

    socket.send(JSON.stringify({ type: "unsubscribe", symbol: DEMO_SYMBOL }));
    await new Promise((resolve) => setTimeout(resolve, 50));

    const afterUnsubscribe = nextMessage(socket, () => true, 400);

    await placeOrder({
      userId: "alice",
      symbol: DEMO_SYMBOL,
      side: "sell",
      type: "limit",
      priceInCents: 5050,
      quantity: 100,
    });

    await expect(afterUnsubscribe).rejects.toThrow("Timed out");
  });

  it("delivers to every subscribed client", async () => {
    const first = await connect();
    const second = await connect();

    first.send(JSON.stringify({ type: "subscribe", symbol: DEMO_SYMBOL }));
    second.send(JSON.stringify({ type: "subscribe", symbol: DEMO_SYMBOL }));
    await nextMessage(first, (m) => m.type === "book");
    await nextMessage(second, (m) => m.type === "book");

    const firstUpdate = nextMessage(
      first,
      (m) => m.type === "book" && (m.book?.asks.length ?? 0) > 0
    );
    const secondUpdate = nextMessage(
      second,
      (m) => m.type === "book" && (m.book?.asks.length ?? 0) > 0
    );

    await placeOrder({
      userId: "alice",
      symbol: DEMO_SYMBOL,
      side: "sell",
      type: "limit",
      priceInCents: 5050,
      quantity: 100,
    });

    await Promise.all([firstUpdate, secondUpdate]);
  });

  it("drops a client cleanly on disconnect", async () => {
    const built = await buildServer({
      logPath: null,
      broadcastIntervalMs: 20,
      authPepper: "test-pepper",
      admin: null,
    });
    await built.app.listen({ port: 0, host: "127.0.0.1" });

    const address = built.app.server.address();
    if (typeof address === "string" || address === null) {
      throw new Error("Expected a TCP address");
    }

    const socket = new WebSocket(`ws://127.0.0.1:${address.port}/ws`);
    await new Promise((resolve) => socket.once("open", resolve));

    expect(built.broadcaster.clientCount()).toBe(1);

    socket.close();
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(built.broadcaster.clientCount()).toBe(0);
    await built.app.close();
  });

  it("coalesces rapid changes into fewer messages", async () => {
    const socket = await connect();
    socket.send(JSON.stringify({ type: "subscribe", symbol: DEMO_SYMBOL }));
    await nextMessage(socket, (m) => m.type === "book");

    let bookMessages = 0;
    socket.on("message", (raw: Buffer) => {
      const message = JSON.parse(raw.toString()) as Message;
      if (message.type === "book") {
        bookMessages += 1;
      }
    });

    for (let i = 0; i < 20; i += 1) {
      await placeOrder({
        userId: "alice",
        symbol: DEMO_SYMBOL,
        side: "sell",
        type: "limit",
        priceInCents: 5000 + i,
        quantity: 10,
      });
    }

    await new Promise((resolve) => setTimeout(resolve, 200));

    expect(bookMessages).toBeGreaterThan(0);
    expect(bookMessages).toBeLessThan(20);
  });
});