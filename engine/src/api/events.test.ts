import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildServer } from "../server.js";

const HOUR = 60 * 60 * 1000;

describe("event and ticket routes", () => {
  let app: FastifyInstance;
  let codes: { email: string; code: string }[];
  let organizer: string;
  let rival: string;
  let fan: string;

  beforeEach(async () => {
    codes = [];
    const built = await buildServer({
      logPath: null,
      authPepper: "test-pepper",
      organizerEmails: ["promoter@example.com", "rival@example.com"],
      sendCode: (email, code) => {
        codes.push({ email, code });
      },
    });
    app = built.app;
    await app.ready();

    organizer = await signIn("promoter@example.com");
    rival = await signIn("rival@example.com");
    fan = await signIn("fan@example.com");
  });

  afterEach(async () => {
    await app.close();
  });

  async function signIn(email: string): Promise<string> {
    await app.inject({ method: "POST", url: "/auth/request", payload: { email } });
    const code = codes[codes.length - 1]!.code;
    const response = await app.inject({
      method: "POST",
      url: "/auth/verify",
      payload: { email, code },
    });
    return response.cookies.find((entry) => entry.name === "session")!.value;
  }

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
    session = organizer,
    overrides: Record<string, unknown> = {}
  ) {
    return app.inject({
      method: "POST",
      url: "/events",
      payload: eventBody(overrides),
      cookies: { session },
    });
  }

  async function issue(eventId: string, count: number, session = organizer) {
    return app.inject({
      method: "POST",
      url: `/events/${eventId}/tickets`,
      payload: { tierId: "GA", count },
      cookies: { session },
    });
  }

  it("makes the signed-in organizer the owner of a new event", async () => {
    const response = await createEvent();

    expect(response.statusCode).toBe(201);
    const { event } = response.json();
    expect(event.id).toMatch(/^evt_\d+$/);
    expect(event.status).toBe("on_sale");
    expect(event.resaleOpen).toBe(true);
    expect(event.tiers[0].symbol).toBe(`${event.id}:GA`);
    expect(event.tiers[0].issued).toBe(0);

    const me = await app.inject({ method: "GET", url: "/me", cookies: { session: organizer } });
    expect(event.organizerId).toBe(me.json().user.id);
  });

  it("refuses to create an event for an attendee", async () => {
    const response = await createEvent(fan);

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
    const response = await createEvent(organizer, {
      salesCloseAt: Date.now() - HOUR,
    });

    expect(response.statusCode).toBe(400);
  });

  it("rejects a cutoff that lands after the doors open", async () => {
    const closesAt = Date.now() + 48 * HOUR;
    const response = await createEvent(organizer, {
      salesCloseAt: closesAt,
      startsAt: closesAt - HOUR,
    });

    expect(response.statusCode).toBe(400);
  });

  it("rejects two tiers with the same id", async () => {
    const response = await createEvent(organizer, {
      tiers: [
        { tierId: "GA", name: "One", faceValueInCents: 1000, perPersonLimit: 2 },
        { tierId: "GA", name: "Two", faceValueInCents: 2000, perPersonLimit: 2 },
      ],
    });

    expect(response.statusCode).toBe(400);
  });

  it("rejects an event with no tiers", async () => {
    const response = await createEvent(organizer, { tiers: [] });

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

  it("issues tickets into the organizer's own account", async () => {
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

  it("refuses to let one organizer issue tickets for another's event", async () => {
    const { event } = (await createEvent()).json();

    const response = await issue(event.id, 10, rival);

    expect(response.statusCode).toBe(403);
  });

  it("refuses to issue tickets for a tier that does not exist", async () => {
    const { event } = (await createEvent()).json();

    const response = await app.inject({
      method: "POST",
      url: `/events/${event.id}/tickets`,
      payload: { tierId: "VIP", count: 10 },
      cookies: { session: organizer },
    });

    expect(response.statusCode).toBe(404);
  });

  it("shows tickets on the holder's own list and nobody else's", async () => {
    const { event } = (await createEvent()).json();
    await issue(event.id, 3);

    const mine = await app.inject({
      method: "GET",
      url: "/tickets",
      cookies: { session: organizer },
    });
    const theirs = await app.inject({
      method: "GET",
      url: "/tickets",
      cookies: { session: fan },
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
      cookies: { session: organizer },
    });
    await app.inject({
      method: "POST",
      url: "/orders",
      payload: { symbol, side: "buy", type: "limit", priceInCents: 1500, quantity: 2 },
      cookies: { session: fan },
    });

    const mine = await app.inject({
      method: "GET",
      url: "/tickets",
      cookies: { session: fan },
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
      cookies: { session: organizer },
    });
    await app.inject({
      method: "POST",
      url: "/orders",
      payload: { symbol, side: "buy", type: "limit", priceInCents: 1000, quantity: 4 },
      cookies: { session: fan },
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
      cookies: { session: organizer },
    });

    const closed = await app.inject({
      method: "POST",
      url: `/events/${event.id}/close`,
      cookies: { session: organizer },
    });

    expect(closed.json().event.status).toBe("closed");
    expect(closed.json().event.resaleOpen).toBe(false);
    expect(closed.json().event.tiers[0].forSale).toBe(0);

    const late = await app.inject({
      method: "POST",
      url: "/orders",
      payload: { symbol, side: "buy", type: "limit", priceInCents: 1500, quantity: 1 },
      cookies: { session: fan },
    });
    expect(late.statusCode).toBe(422);
  });

  it("refuses to issue tickets once sales have closed", async () => {
    const { event } = (await createEvent()).json();
    await app.inject({
      method: "POST",
      url: `/events/${event.id}/close`,
      cookies: { session: organizer },
    });

    const response = await issue(event.id, 5);

    expect(response.statusCode).toBe(409);
  });

  it("cancels an event", async () => {
    const { event } = (await createEvent()).json();

    const response = await app.inject({
      method: "POST",
      url: `/events/${event.id}/cancel`,
      cookies: { session: organizer },
    });

    expect(response.json().event.status).toBe("cancelled");
  });

  it("refuses to let a rival organizer close or cancel", async () => {
    const { event } = (await createEvent()).json();

    const closed = await app.inject({
      method: "POST",
      url: `/events/${event.id}/close`,
      cookies: { session: rival },
    });
    const cancelled = await app.inject({
      method: "POST",
      url: `/events/${event.id}/cancel`,
      cookies: { session: fan },
    });

    expect(closed.statusCode).toBe(403);
    expect(cancelled.statusCode).toBe(403);
  });

  it("reports what has happened to an organizer's own event", async () => {
    const { event } = (await createEvent()).json();
    await issue(event.id, 6);
    const symbol = `${event.id}:GA`;

    await app.inject({
      method: "POST",
      url: "/orders",
      payload: { symbol, side: "sell", type: "limit", priceInCents: 1500, quantity: 2 },
      cookies: { session: organizer },
    });
    await app.inject({
      method: "POST",
      url: "/orders",
      payload: { symbol, side: "buy", type: "limit", priceInCents: 1500, quantity: 2 },
      cookies: { session: fan },
    });
    await app.inject({
      method: "POST",
      url: "/orders",
      payload: { symbol, side: "sell", type: "limit", priceInCents: 1200, quantity: 1 },
      cookies: { session: fan },
    });

    const response = await app.inject({
      method: "GET",
      url: `/events/${event.id}/report`,
      cookies: { session: organizer },
    });

    expect(response.statusCode).toBe(200);
    const tier = response.json().tiers[0];
    expect(tier).toMatchObject({
      issued: 6,
      withOrganizer: 4,
      withFans: 2,
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

    await sell(organizer, 1500, 1);
    await buy(fan, 1500, 1);
    await sell(fan, 1500, 1);
    await buy(rival, 1500, 1);

    const response = await app.inject({
      method: "GET",
      url: `/events/${event.id}/report`,
      cookies: { session: organizer },
    });

    expect(response.json().tiers[0]).toMatchObject({
      withOrganizer: 3,
      withFans: 1,
      passedOn: 1,
    });
  });

  it("refuses to report on somebody else's event", async () => {
    const { event } = (await createEvent()).json();

    const rivalView = await app.inject({
      method: "GET",
      url: `/events/${event.id}/report`,
      cookies: { session: rival },
    });
    const fanView = await app.inject({
      method: "GET",
      url: `/events/${event.id}/report`,
      cookies: { session: fan },
    });

    expect(rivalView.statusCode).toBe(403);
    expect(fanView.statusCode).toBe(403);
  });

  it("gives each new event its own id", async () => {
    const first = (await createEvent()).json().event.id;
    const second = (await createEvent()).json().event.id;

    expect(first).not.toBe(second);
  });
});
