import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildServer } from "../server.js";
import { PassIssuer } from "./passes.js";

const HOUR = 60 * 60 * 1000;
const DOOR_KEY = "test-door-key";

describe("the door", () => {
  let app: FastifyInstance;
  let codes: { email: string; code: string }[];
  let organizer: string;
  let staff: string;
  let rosie: string;
  let sam: string;
  let eventId: string;
  let symbol: string;

  beforeEach(async () => {
    codes = [];
    const built = await buildServer({
      logPath: null,
      authPepper: "test-pepper",
      doorKey: DOOR_KEY,
      organizerEmails: ["promoter@example.com"],
      staffEmails: ["door@example.com"],
      sendCode: (email, code) => {
        codes.push({ email, code });
      },
    });
    app = built.app;
    await app.ready();

    organizer = await signIn("promoter@example.com");
    staff = await signIn("door@example.com");
    rosie = await signIn("rosie@example.com");
    sam = await signIn("sam@example.com");

    const closesAt = Date.now() + 24 * HOUR;
    const created = await app.inject({
      method: "POST",
      url: "/events",
      cookies: { session: organizer },
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
      cookies: { session: organizer },
      payload: { tierId: "GA", count: 5 },
    });
    await order(organizer, "sell", 2);
    await order(rosie, "buy", 2);
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

    const response = await scan(staff, token);

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

    await scan(staff, token);
    const again = await scan(staff, token);

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

    const response = await scan(staff, token);

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
    const response = await scan(staff, token);

    expect(response.json().admitted).toBe(true);
  });

  it("refuses a pass signed with the wrong key", async () => {
    const [ticket] = await ticketsOf(rosie);
    const { token } = new PassIssuer("some-other-key").issue(ticket!.id, 1);

    const response = await scan(staff, token);

    expect(response.json()).toMatchObject({ admitted: false, reason: "forged" });
  });

  it("refuses a pass for a different event", async () => {
    const [ticket] = await ticketsOf(rosie);
    const { token } = (await passFor(rosie, ticket!.id)).json();

    const closesAt = Date.now() + 24 * HOUR;
    const other = await app.inject({
      method: "POST",
      url: "/events",
      cookies: { session: organizer },
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

    const response = await scan(staff, token, other.json().event.id);

    expect(response.json()).toMatchObject({
      admitted: false,
      reason: "wrong_event",
    });
  });

  it("refuses something that is not a pass at all", async () => {
    const response = await scan(staff, "have-me-in");

    expect(response.json()).toMatchObject({
      admitted: false,
      reason: "not_a_pass",
    });
  });

  it("refuses to scan for an event that does not exist", async () => {
    const [ticket] = await ticketsOf(rosie);
    const { token } = (await passFor(rosie, ticket!.id)).json();

    const response = await scan(staff, token, "evt_nope");

    expect(response.statusCode).toBe(404);
  });

  it("lets an organizer work their own door", async () => {
    const [ticket] = await ticketsOf(rosie);
    const { token } = (await passFor(rosie, ticket!.id)).json();

    const response = await scan(organizer, token);

    expect(response.json().admitted).toBe(true);
  });

  it("refuses to let a fan scan anybody in", async () => {
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
      cookies: { session: organizer },
    });

    const response = await scan(staff, token);

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
      cookies: { session: organizer },
    });

    const response = await passFor(rosie, ticket!.id);

    expect(response.statusCode).toBe(409);
    expect(response.json().cancelled).toBe(true);
  });

  it("remembers who came in once the pass is used", async () => {
    const [ticket] = await ticketsOf(rosie);
    const { token } = (await passFor(rosie, ticket!.id)).json();
    await scan(staff, token);

    const response = await passFor(rosie, ticket!.id);

    expect(response.json().admittedAt).toBeGreaterThan(0);
  });
});
