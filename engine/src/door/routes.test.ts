import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildServer } from "../server.js";
import { PassIssuer } from "./passes.js";
import { signIn, signUp } from "../testAuth.js";

const HOUR = 60 * 60 * 1000;
const DOOR_KEY = "test-door-key";

describe("the door", () => {
  let app: FastifyInstance;
  let admin: string;
  let rosie: string;
  let sam: string;
  let eventId: string;
  let symbol: string;

  beforeEach(async () => {
    const built = await buildServer({
      logPath: null,
      authPepper: "test-pepper",
      doorKey: DOOR_KEY,
      admin: { email: "admin@example.com", password: "admin-password", name: "Admin" },
    });
    app = built.app;
    await app.ready();

    admin = await signIn(app, "admin@example.com", "admin-password");
    rosie = await signUp(app, "rosie@example.com");
    sam = await signUp(app, "sam@example.com");

    const closesAt = Date.now() + 24 * HOUR;
    const created = await app.inject({
      method: "POST",
      url: "/events",
      cookies: { session: admin },
      payload: {
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
      },
    });
    eventId = created.json().event.id;
    symbol = `${eventId}:GA`;

    await app.inject({
      method: "POST",
      url: `/events/${eventId}/tickets`,
      cookies: { session: admin },
      payload: { tierId: "GA", count: 5 },
    });
    await order(admin, "sell", 2);
    await order(rosie, "buy", 2);
  });

  afterEach(async () => {
    await app.close();
  });

  function order(session: string, side: "buy" | "sell", quantity: number) {
    return app.inject({
      method: "POST",
      url: "/orders",
      cookies: { session },
      payload: { symbol, side, type: "limit", priceInCents: 1500, quantity },
    });
  }

  async function ticketsOf(session: string) {
    const response = await app.inject({
      method: "GET",
      url: "/tickets",
      cookies: { session },
    });
    return response.json().tickets as { id: string; serial: number }[];
  }

  async function passFor(session: string, ticketId: string) {
    return app.inject({
      method: "GET",
      url: `/tickets/${ticketId}/pass`,
      cookies: { session },
    });
  }

  function scan(session: string, token: string, forEvent = eventId) {
    return app.inject({
      method: "POST",
      url: "/scan",
      cookies: { session },
      payload: { token, eventId: forEvent },
    });
  }

  it("gives the holder a pass for their own ticket", async () => {
    const [ticket] = await ticketsOf(rosie);
    const response = await passFor(rosie, ticket!.id);

    expect(response.statusCode).toBe(200);
    expect(response.json().token.startsWith(`${ticket!.id}.`)).toBe(true);
    expect(response.json().serial).toBe(ticket!.serial);
    expect(response.json().expiresAt).toBeGreaterThan(Date.now());
  });

  it("refuses a pass for a ticket somebody else holds", async () => {
    const [ticket] = await ticketsOf(rosie);
    const response = await passFor(sam, ticket!.id);

    expect(response.statusCode).toBe(404);
  });

  it("refuses a pass without a session", async () => {
    const [ticket] = await ticketsOf(rosie);
    const response = await app.inject({
      method: "GET",
      url: `/tickets/${ticket!.id}/pass`,
    });

    expect(response.statusCode).toBe(401);
  });

  it("lets somebody in on a fresh pass", async () => {
    const [ticket] = await ticketsOf(rosie);
    const { token } = (await passFor(rosie, ticket!.id)).json();

    const response = await scan(admin, token);

    expect(response.json()).toMatchObject({
      admitted: true,
      serial: ticket!.serial,
      tierName: "General admission",
      owedInCents: 1500,
    });
  });

  it("refuses the same pass a second time", async () => {
    const [ticket] = await ticketsOf(rosie);
    const { token } = (await passFor(rosie, ticket!.id)).json();

    await scan(admin, token);
    const again = await scan(admin, token);

    expect(again.json()).toMatchObject({
      admitted: false,
      reason: "already_inside",
      serial: ticket!.serial,
    });
  });

  it("refuses a pass for a ticket that has since been passed on", async () => {
    const [ticket] = await ticketsOf(rosie);
    const { token } = (await passFor(rosie, ticket!.id)).json();

    await order(rosie, "sell", 1);
    await order(sam, "buy", 1);

    const response = await scan(admin, token);

    expect(response.json()).toMatchObject({
      admitted: false,
      reason: "passed_on",
    });
  });

  it("lets the new holder in with their own pass", async () => {
    const [ticket] = await ticketsOf(rosie);
    await order(rosie, "sell", 1);
    await order(sam, "buy", 1);

    const { token } = (await passFor(sam, ticket!.id)).json();
    const response = await scan(admin, token);

    expect(response.json().admitted).toBe(true);
  });

  it("refuses a pass signed with the wrong key", async () => {
    const [ticket] = await ticketsOf(rosie);
    const { token } = new PassIssuer("some-other-key").issue(ticket!.id, 1);

    const response = await scan(admin, token);

    expect(response.json()).toMatchObject({ admitted: false, reason: "forged" });
  });

  it("refuses a pass for a different event", async () => {
    const [ticket] = await ticketsOf(rosie);
    const { token } = (await passFor(rosie, ticket!.id)).json();

    const closesAt = Date.now() + 24 * HOUR;
    const other = await app.inject({
      method: "POST",
      url: "/events",
      cookies: { session: admin },
      payload: {
        name: "Another night",
        venue: "Elsewhere",
        salesCloseAt: closesAt,
        startsAt: closesAt + HOUR,
        tiers: [
          { tierId: "GA", name: "Standing", faceValueInCents: 1000, perPersonLimit: 2 },
        ],
      },
    });

    const response = await scan(admin, token, other.json().event.id);

    expect(response.json()).toMatchObject({
      admitted: false,
      reason: "wrong_event",
    });
  });

  it("refuses something that is not a pass at all", async () => {
    const response = await scan(admin, "have-me-in");

    expect(response.json()).toMatchObject({
      admitted: false,
      reason: "not_a_pass",
    });
  });

  it("refuses to scan for an event that does not exist", async () => {
    const [ticket] = await ticketsOf(rosie);
    const { token } = (await passFor(rosie, ticket!.id)).json();

    const response = await scan(admin, token, "evt_nope");

    expect(response.statusCode).toBe(404);
  });

  it("refuses to let a customer scan anybody in", async () => {
    const [ticket] = await ticketsOf(rosie);
    const { token } = (await passFor(rosie, ticket!.id)).json();

    const response = await scan(sam, token);

    expect(response.statusCode).toBe(403);
  });

  it("turns everybody away once an event is cancelled", async () => {
    const [ticket] = await ticketsOf(rosie);
    const { token } = (await passFor(rosie, ticket!.id)).json();

    await app.inject({
      method: "POST",
      url: `/events/${eventId}/cancel`,
      cookies: { session: admin },
    });

    const response = await scan(admin, token);

    expect(response.json()).toMatchObject({
      admitted: false,
      reason: "event_off",
    });
  });

  it("stops handing out passes for a cancelled event", async () => {
    const [ticket] = await ticketsOf(rosie);

    await app.inject({
      method: "POST",
      url: `/events/${eventId}/cancel`,
      cookies: { session: admin },
    });

    const response = await passFor(rosie, ticket!.id);

    expect(response.statusCode).toBe(409);
    expect(response.json().cancelled).toBe(true);
  });

  it("refuses a pass for a ticket that is waiting to be passed on", async () => {
    const [ticket] = await ticketsOf(rosie);

    await order(rosie, "sell", 1);

    const response = await passFor(rosie, ticket!.id);

    expect(response.statusCode).toBe(409);
    expect(response.json().reserved).toBe(true);
  });

  it("gives the pass back once the seller withdraws", async () => {
    const [ticket] = await ticketsOf(rosie);

    const placed = await order(rosie, "sell", 1);
    const orderId = placed.json().order.id;
    expect((await passFor(rosie, ticket!.id)).statusCode).toBe(409);

    await app.inject({
      method: "DELETE",
      url: `/orders/${orderId}`,
      cookies: { session: rosie },
    });

    expect((await passFor(rosie, ticket!.id)).statusCode).toBe(200);
  });

  it("only reserves as many tickets as are actually listed", async () => {
    const tickets = await ticketsOf(rosie);
    expect(tickets.length).toBe(2);

    await order(rosie, "sell", 1);

    const listed = await app.inject({
      method: "GET",
      url: "/tickets",
      cookies: { session: rosie },
    });
    const flags = listed.json().tickets.map((t: { reserved: boolean }) => t.reserved);
    expect(flags.filter(Boolean)).toHaveLength(1);

    expect((await passFor(rosie, tickets[1]!.id)).statusCode).toBe(200);
  });

  it("stops the door letting in a ticket somebody has already sold", async () => {
    const [ticket] = await ticketsOf(rosie);
    const { token } = (await passFor(rosie, ticket!.id)).json();

    await order(rosie, "sell", 1);
    await order(sam, "buy", 1);

    const response = await scan(admin, token);

    expect(response.json().admitted).toBe(false);
  });

  it("remembers who came in once the pass is used", async () => {
    const [ticket] = await ticketsOf(rosie);
    const { token } = (await passFor(rosie, ticket!.id)).json();
    await scan(admin, token);

    const response = await passFor(rosie, ticket!.id);

    expect(response.json().admittedAt).toBeGreaterThan(0);
  });
});
