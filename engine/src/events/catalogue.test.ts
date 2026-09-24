import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildServer } from "../server.js";
import { signIn, signUp } from "../testAuth.js";
import type { SeedEvent } from "./seed.js";

const ADMIN = {
  email: "admin@example.com",
  password: "admin-password",
  name: "Admin",
};

const CATALOGUE: SeedEvent[] = [
  {
    id: "evt_basement",
    name: "Basement show",
    venue: "The Old Mill",
    startsInDays: 10,
    salesCloseHoursBefore: 4,
    tiers: [
      {
        tierId: "GA",
        name: "Standing",
        faceValueInCents: 1500,
        perPersonLimit: 4,
        print: 40,
        release: 0,
      },
    ],
  },
];

describe("the seeded catalogue", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "facevalue-catalogue-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function start(logPath: string | null) {
    return buildServer({
      logPath,
      authPepper: "test-pepper",
      admin: ADMIN,
      seed: CATALOGUE,
    });
  }

  it("puts the catalogue out front without anybody signing in", async () => {
    const { app } = await start(null);
    await app.ready();

    const response = await app.inject({ method: "GET", url: "/events" });

    expect(response.statusCode).toBe(200);
    const events = response.json().events as { id: string; resaleOpen: boolean }[];
    expect(events.map((event) => event.id)).toEqual(["evt_basement"]);
    expect(events[0]!.resaleOpen).toBe(true);

    await app.close();
  });

  it("gives the catalogue to the admin, not to whoever signs in first", async () => {
    const { app } = await start(null);
    await app.ready();

    const admin = await signIn(app, ADMIN.email, ADMIN.password);
    const adminId = (
      await app.inject({ method: "GET", url: "/me", cookies: { session: admin } })
    ).json().user.id;

    const { event } = (
      await app.inject({ method: "GET", url: "/events/evt_basement" })
    ).json();
    expect(event.organizerId).toBe(adminId);

    const held = await app.inject({
      method: "GET",
      url: "/tickets",
      cookies: { session: admin },
    });
    expect(held.json().tickets).toHaveLength(40);

    await app.close();
  });

  it("does not seed it a second time when the log is replayed", async () => {
    const logPath = join(dir, "events.jsonl");

    const first = await start(logPath);
    await first.app.ready();
    expect(first.seeded.created).toEqual(["evt_basement"]);
    await first.app.close();

    const second = await start(logPath);
    await second.app.ready();

    expect(second.seeded.created).toEqual([]);
    expect(second.seeded.skipped).toEqual(["evt_basement"]);

    const events = (
      await second.app.inject({ method: "GET", url: "/events" })
    ).json().events as { id: string; tiers: { issued: number }[] }[];
    expect(events).toHaveLength(1);
    expect(events[0]!.tiers[0]!.issued).toBe(40);

    await second.app.close();
  });

  it("keeps the dates it was first seeded with across a restart", async () => {
    const logPath = join(dir, "events.jsonl");

    const first = await start(logPath);
    await first.app.ready();
    const before = (
      await first.app.inject({ method: "GET", url: "/events/evt_basement" })
    ).json().event;
    await first.app.close();

    const second = await start(logPath);
    await second.app.ready();
    const after = (
      await second.app.inject({ method: "GET", url: "/events/evt_basement" })
    ).json().event;
    await second.app.close();

    expect(after.startsAt).toBe(before.startsAt);
    expect(after.salesCloseAt).toBe(before.salesCloseAt);
  });

  it("lets a customer claim one of the seeded tickets once they are released", async () => {
    const { app } = await start(null);
    await app.ready();

    const admin = await signIn(app, ADMIN.email, ADMIN.password);
    const customer = await signUp(app, "customer@example.com", "customer");

    await app.inject({
      method: "POST",
      url: "/orders",
      cookies: { session: admin },
      payload: {
        symbol: "evt_basement:GA",
        side: "sell",
        type: "limit",
        priceInCents: 1500,
        quantity: 10,
      },
    });

    const claimed = await app.inject({
      method: "POST",
      url: "/orders",
      cookies: { session: customer },
      payload: {
        symbol: "evt_basement:GA",
        side: "buy",
        type: "limit",
        priceInCents: 1500,
        quantity: 1,
      },
    });

    expect(claimed.statusCode).toBe(201);
    expect(claimed.json().trades).toHaveLength(1);

    const mine = await app.inject({
      method: "GET",
      url: "/tickets",
      cookies: { session: customer },
    });
    expect(mine.json().tickets).toHaveLength(1);
    expect(mine.json().tickets[0].eventName).toBe("Basement show");

    await app.close();
  });

  it("seeds nothing when there is no admin to own it", async () => {
    const { app, seeded } = await buildServer({
      logPath: null,
      authPepper: "test-pepper",
      admin: null,
      seed: CATALOGUE,
    });
    await app.ready();

    expect(seeded.created).toEqual([]);
    expect((await app.inject({ method: "GET", url: "/events" })).json().events).toEqual(
      []
    );

    await app.close();
  });

  it("seeds nothing when there is no catalogue", async () => {
    const { app, seeded } = await buildServer({
      logPath: null,
      authPepper: "test-pepper",
      admin: ADMIN,
      seed: null,
    });
    await app.ready();

    expect(seeded.created).toEqual([]);
    expect((await app.inject({ method: "GET", url: "/events" })).json().events).toEqual(
      []
    );

    await app.close();
  });
});
