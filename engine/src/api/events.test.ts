import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildServer } from "../server.js";
import { signIn, signUp } from "../testAuth.js";

const HOUR = 60 * 60 * 1000;

describe("event and ticket routes", () => {
  let app: FastifyInstance;
  let admin: string;
  let seller: string;
  let customer: string;

  beforeEach(async () => {
    const built = await buildServer({
      logPath: null,
      authPepper: "test-pepper",
      admin: {
        email: "admin@example.com",
        password: "admin-password",
        name: "Admin",
      },
    });
    app = built.app;
    await app.ready();

    admin = await signIn(app, "admin@example.com", "admin-password");
    seller = await signUp(app, "seller@example.com", { buys: false, sells: true });
    customer = await signUp(app, "customer@example.com");
  });

  afterEach(async () => {
    await app.close();
  });

  function eventBody(overrides: Record<string, unknown> = {}) {
    const closesAt = Date.now() + 24 * HOUR;
    return {
      name: "Basement show",
      venue: "The Old Mill",
      salesCloseAt: closesAt,
      startsAt: closesAt + HOUR,
      tiers: [
        {
          tierId: "GA",
          name: "General admission",
          faceValueInCents: 1500,
          perPersonLimit: 4,
        },
      ],
      ...overrides,
    };
  }

  async function createEvent(
    session = admin,
    overrides: Record<string, unknown> = {}
  ) {
    return app.inject({
      method: "POST",
      url: "/events",
      payload: eventBody(overrides),
      cookies: { session },
    });
  }

  async function issue(eventId: string, count: number, session = admin) {
    return app.inject({
      method: "POST",
      url: `/events/${eventId}/tickets`,
      payload: { tierId: "GA", count },
      cookies: { session },
    });
  }

  it("records the admin as the owner of a new event", async () => {
    const response = await createEvent();

    expect(response.statusCode).toBe(201);
    const { event } = response.json();
    expect(event.id).toMatch(/^evt_\d+$/);
    expect(event.status).toBe("on_sale");
    expect(event.resaleOpen).toBe(true);
    expect(event.tiers[0].symbol).toBe(`${event.id}:GA`);
    expect(event.tiers[0].issued).toBe(0);

    const me = await app.inject({
      method: "GET",
      url: "/me",
      cookies: { session: admin },
    });
    expect(event.organizerId).toBe(me.json().user.id);
  });

  it("refuses to create an event for a customer", async () => {
    const response = await createEvent(customer);

    expect(response.statusCode).toBe(403);
  });

  it("refuses to create an event for a seller", async () => {
    const response = await createEvent(seller);

    expect(response.statusCode).toBe(403);
  });

  it("refuses to create an event for a signed-out visitor", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/events",
      payload: eventBody(),
    });

    expect(response.statusCode).toBe(401);
  });

  it("rejects a sales cutoff in the past", async () => {
    const response = await createEvent(admin, {
      salesCloseAt: Date.now() - HOUR,
    });

    expect(response.statusCode).toBe(400);
  });

  it("rejects a cutoff that lands after the doors open", async () => {
    const closesAt = Date.now() + 48 * HOUR;
    const response = await createEvent(admin, {
      salesCloseAt: closesAt,
      startsAt: closesAt - HOUR,
    });

    expect(response.statusCode).toBe(400);
  });

  it("rejects two tiers with the same id", async () => {
    const response = await createEvent(admin, {
      tiers: [
        { tierId: "GA", name: "One", faceValueInCents: 1000, perPersonLimit: 2 },
        { tierId: "GA", name: "Two", faceValueInCents: 2000, perPersonLimit: 2 },
      ],
    });

    expect(response.statusCode).toBe(400);
  });

  it("rejects an event with no tiers", async () => {
    const response = await createEvent(admin, { tiers: [] });

    expect(response.statusCode).toBe(400);
  });

  it("lists events without a session", async () => {
    const { event } = (await createEvent()).json();

    const response = await app.inject({ method: "GET", url: "/events" });

    expect(response.statusCode).toBe(200);
    expect(response.json().events.map((entry: { id: string }) => entry.id)).toEqual([
      event.id,
    ]);
  });

  it("returns 404 for an event that does not exist", async () => {
    const response = await app.inject({ method: "GET", url: "/events/evt_nope" });

    expect(response.statusCode).toBe(404);
  });

  it("issues tickets into the admin's own account", async () => {
    const { event } = (await createEvent()).json();

    const response = await issue(event.id, 50);

    expect(response.statusCode).toBe(201);
    expect(response.json().issued).toBe(50);
    expect(response.json().event.tiers[0].issued).toBe(50);
  });

  it("adds to the count when tickets are issued twice", async () => {
    const { event } = (await createEvent()).json();

    await issue(event.id, 10);
    const response = await issue(event.id, 5);

    expect(response.json().issued).toBe(15);
  });

  it("refuses to let a seller issue tickets", async () => {
    const { event } = (await createEvent()).json();

    const response = await issue(event.id, 10, seller);

    expect(response.statusCode).toBe(403);
  });

  it("refuses to issue tickets for a tier that does not exist", async () => {
    const { event } = (await createEvent()).json();

    const response = await app.inject({
      method: "POST",
      url: `/events/${event.id}/tickets`,
      payload: { tierId: "VIP", count: 10 },
      cookies: { session: admin },
    });

    expect(response.statusCode).toBe(404);
  });

  it("shows tickets on the holder's own list and nobody else's", async () => {
    const { event } = (await createEvent()).json();
    await issue(event.id, 3);

    const mine = await app.inject({
      method: "GET",
      url: "/tickets",
      cookies: { session: admin },
    });
    const theirs = await app.inject({
      method: "GET",
      url: "/tickets",
      cookies: { session: customer },
    });

    expect(mine.json().tickets).toHaveLength(3);
    expect(mine.json().tickets[0]).toMatchObject({
      serial: 1,
      rotation: 0,
      eventId: event.id,
      eventName: "Basement show",
      tierName: "General admission",
    });
    expect(theirs.json().tickets).toEqual([]);
  });

  it("refuses to list tickets without a session", async () => {
    const response = await app.inject({ method: "GET", url: "/tickets" });

    expect(response.statusCode).toBe(401);
  });

  it("moves a ticket onto the buyer's list once it trades", async () => {
    const { event } = (await createEvent()).json();
    await issue(event.id, 5);
    const symbol = `${event.id}:GA`;

    await app.inject({
      method: "POST",
      url: "/orders",
      payload: { symbol, side: "sell", type: "limit", priceInCents: 1500, quantity: 2 },
      cookies: { session: admin },
    });
    await app.inject({
      method: "POST",
      url: "/orders",
      payload: { symbol, side: "buy", type: "limit", priceInCents: 1500, quantity: 2 },
      cookies: { session: customer },
    });

    const mine = await app.inject({
      method: "GET",
      url: "/tickets",
      cookies: { session: customer },
    });

    expect(mine.json().tickets.map((t: { serial: number }) => t.serial)).toEqual([1, 2]);
    expect(mine.json().tickets[0].rotation).toBe(1);
  });

  it("counts what is for sale and who is waiting", async () => {
    const { event } = (await createEvent()).json();
    await issue(event.id, 5);
    const symbol = `${event.id}:GA`;

    await app.inject({
      method: "POST",
      url: "/orders",
      payload: { symbol, side: "sell", type: "limit", priceInCents: 1500, quantity: 3 },
      cookies: { session: admin },
    });
    await app.inject({
      method: "POST",
      url: "/orders",
      payload: { symbol, side: "buy", type: "limit", priceInCents: 1000, quantity: 4 },
      cookies: { session: customer },
    });

    const response = await app.inject({ method: "GET", url: `/events/${event.id}` });

    expect(response.json().event.tiers[0]).toMatchObject({
      issued: 5,
      forSale: 3,
      waiting: 4,
    });
  });

  it("closes sales and clears the book", async () => {
    const { event } = (await createEvent()).json();
    await issue(event.id, 5);
    const symbol = `${event.id}:GA`;

    await app.inject({
      method: "POST",
      url: "/orders",
      payload: { symbol, side: "sell", type: "limit", priceInCents: 1500, quantity: 3 },
      cookies: { session: admin },
    });

    const closed = await app.inject({
      method: "POST",
      url: `/events/${event.id}/close`,
      cookies: { session: admin },
    });

    expect(closed.json().event.status).toBe("closed");
    expect(closed.json().event.resaleOpen).toBe(false);
    expect(closed.json().event.tiers[0].forSale).toBe(0);

    const late = await app.inject({
      method: "POST",
      url: "/orders",
      payload: { symbol, side: "buy", type: "limit", priceInCents: 1500, quantity: 1 },
      cookies: { session: customer },
    });
    expect(late.statusCode).toBe(422);
  });

  it("refuses to issue tickets once sales have closed", async () => {
    const { event } = (await createEvent()).json();
    await app.inject({
      method: "POST",
      url: `/events/${event.id}/close`,
      cookies: { session: admin },
    });

    const response = await issue(event.id, 5);

    expect(response.statusCode).toBe(409);
  });

  it("cancels an event", async () => {
    const { event } = (await createEvent()).json();

    const response = await app.inject({
      method: "POST",
      url: `/events/${event.id}/cancel`,
      cookies: { session: admin },
    });

    expect(response.json().event.status).toBe("cancelled");
  });

  it("refuses to let a seller or a customer close or cancel", async () => {
    const { event } = (await createEvent()).json();

    const closed = await app.inject({
      method: "POST",
      url: `/events/${event.id}/close`,
      cookies: { session: seller },
    });
    const cancelled = await app.inject({
      method: "POST",
      url: `/events/${event.id}/cancel`,
      cookies: { session: customer },
    });

    expect(closed.statusCode).toBe(403);
    expect(cancelled.statusCode).toBe(403);
  });

  it("reports what has happened to an event", async () => {
    const { event } = (await createEvent()).json();
    await issue(event.id, 6);
    const symbol = `${event.id}:GA`;

    await app.inject({
      method: "POST",
      url: "/orders",
      payload: { symbol, side: "sell", type: "limit", priceInCents: 1500, quantity: 2 },
      cookies: { session: admin },
    });
    await app.inject({
      method: "POST",
      url: "/orders",
      payload: { symbol, side: "buy", type: "limit", priceInCents: 1500, quantity: 2 },
      cookies: { session: customer },
    });
    await app.inject({
      method: "POST",
      url: "/orders",
      payload: { symbol, side: "sell", type: "limit", priceInCents: 1200, quantity: 1 },
      cookies: { session: customer },
    });

    const response = await app.inject({
      method: "GET",
      url: `/events/${event.id}/report`,
      cookies: { session: admin },
    });

    expect(response.statusCode).toBe(200);
    const tier = response.json().tiers[0];
    expect(tier).toMatchObject({
      issued: 6,
      unsold: 4,
      sold: 2,
      passedOn: 0,
      holders: 2,
      forSale: 1,
      waiting: 0,
    });
    expect(tier.recentTrades).toHaveLength(1);
    expect(tier.recentTrades[0].quantity).toBe(2);
  });

  it("counts a ticket that has been passed on a second time", async () => {
    const { event } = (await createEvent()).json();
    await issue(event.id, 4);
    const symbol = `${event.id}:GA`;

    const other = await signUp(app, "other@example.com");

    const sell = (session: string, price: number, quantity: number) =>
      app.inject({
        method: "POST",
        url: "/orders",
        payload: { symbol, side: "sell", type: "limit", priceInCents: price, quantity },
        cookies: { session },
      });
    const buy = (session: string, price: number, quantity: number) =>
      app.inject({
        method: "POST",
        url: "/orders",
        payload: { symbol, side: "buy", type: "limit", priceInCents: price, quantity },
        cookies: { session },
      });

    await sell(admin, 1500, 1);
    await buy(customer, 1500, 1);
    await sell(customer, 1500, 1);
    await buy(other, 1500, 1);

    const response = await app.inject({
      method: "GET",
      url: `/events/${event.id}/report`,
      cookies: { session: admin },
    });

    expect(response.json().tiers[0]).toMatchObject({
      unsold: 3,
      sold: 1,
      passedOn: 1,
    });
  });

  it("refuses to report on an event to anybody but an admin", async () => {
    const { event } = (await createEvent()).json();

    const sellerView = await app.inject({
      method: "GET",
      url: `/events/${event.id}/report`,
      cookies: { session: seller },
    });
    const customerView = await app.inject({
      method: "GET",
      url: `/events/${event.id}/report`,
      cookies: { session: customer },
    });

    expect(sellerView.statusCode).toBe(403);
    expect(customerView.statusCode).toBe(403);
  });

  it("refuses a buy from an account that does not buy", async () => {
    const { event } = (await createEvent()).json();
    await issue(event.id, 5);
    const symbol = `${event.id}:GA`;

    await app.inject({
      method: "POST",
      url: "/orders",
      payload: { symbol, side: "sell", type: "limit", priceInCents: 1500, quantity: 2 },
      cookies: { session: admin },
    });

    const response = await app.inject({
      method: "POST",
      url: "/orders",
      payload: { symbol, side: "buy", type: "limit", priceInCents: 1500, quantity: 1 },
      cookies: { session: seller },
    });

    expect(response.statusCode).toBe(403);
  });

  it("lets a buy through once buying is turned on", async () => {
    const { event } = (await createEvent()).json();
    await issue(event.id, 5);
    const symbol = `${event.id}:GA`;

    await app.inject({
      method: "POST",
      url: "/orders",
      payload: { symbol, side: "sell", type: "limit", priceInCents: 1500, quantity: 2 },
      cookies: { session: admin },
    });
    await app.inject({
      method: "PATCH",
      url: "/me/settings",
      cookies: { session: seller },
      payload: { buys: true },
    });

    const response = await app.inject({
      method: "POST",
      url: "/orders",
      payload: { symbol, side: "buy", type: "limit", priceInCents: 1500, quantity: 1 },
      cookies: { session: seller },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json().trades).toHaveLength(1);
  });

  it("lets anybody pass on a ticket they already hold", async () => {
    const { event } = (await createEvent()).json();
    await issue(event.id, 5);
    const symbol = `${event.id}:GA`;

    await app.inject({
      method: "POST",
      url: "/orders",
      payload: { symbol, side: "sell", type: "limit", priceInCents: 1500, quantity: 2 },
      cookies: { session: admin },
    });
    await app.inject({
      method: "POST",
      url: "/orders",
      payload: { symbol, side: "buy", type: "limit", priceInCents: 1500, quantity: 1 },
      cookies: { session: customer },
    });

    await app.inject({
      method: "PATCH",
      url: "/me/settings",
      cookies: { session: customer },
      payload: { buys: false, sells: true },
    });

    const passedOn = await app.inject({
      method: "POST",
      url: "/orders",
      payload: { symbol, side: "sell", type: "limit", priceInCents: 1500, quantity: 1 },
      cookies: { session: customer },
    });

    expect(passedOn.statusCode).toBe(201);
  });

  it("gives each new event its own id", async () => {
    const first = (await createEvent()).json().event.id;
    const second = (await createEvent()).json().event.id;

    expect(first).not.toBe(second);
  });
});
