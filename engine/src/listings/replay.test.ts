import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildServer } from "../server.js";
import { signIn, signUp } from "../testAuth.js";
import type { SeedEvent } from "../events/seed.js";

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
        print: 10,
        release: 0,
      },
    ],
  },
];

const JPEG = Buffer.concat([
  Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
  Buffer.alloc(32, 7),
]);

function form(fields: Record<string, string>) {
  const boundary = "----facevaluereplay";
  const parts: Buffer[] = [];
  for (const [name, value] of Object.entries(fields)) {
    parts.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`
      )
    );
  }
  parts.push(
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="photo"; filename="t.jpg"\r\nContent-Type: image/jpeg\r\n\r\n`
    ),
    JPEG,
    Buffer.from("\r\n"),
    Buffer.from(`--${boundary}--\r\n`)
  );
  return {
    payload: Buffer.concat(parts),
    headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
  };
}

describe("listings through a restart", () => {
  let dir: string;
  let logPath: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "facevalue-replay-"));
    logPath = join(dir, "events.jsonl");
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function start() {
    return buildServer({
      logPath,
      authPepper: "test-pepper",
      admin: ADMIN,
      seed: CATALOGUE,
      evidencePath: join(dir, "evidence"),
    });
  }

  it("remembers a pending listing and can still decide it after a restart", async () => {
    const first = await start();
    await first.app.ready();
    const seller = await signUp(first.app, "seller@example.com", {
      buys: false,
      sells: true,
    });
    const { payload, headers } = form({
      eventId: "evt_basement",
      tierId: "GA",
      quantity: "2",
    });
    const submitted = await first.app.inject({
      method: "POST",
      url: "/listings",
      cookies: { session: seller },
      headers,
      payload,
    });
    const listingId = submitted.json().listing.id;
    await first.app.close();

    const second = await start();
    await second.app.ready();

    expect(second.state.listings.get(listingId)?.status).toBe("pending");

    const admin = await signIn(second.app, ADMIN.email, ADMIN.password);
    const approved = await second.app.inject({
      method: "POST",
      url: `/listings/${listingId}/approve`,
      cookies: { session: admin },
    });
    expect(approved.statusCode).toBe(200);

    const event = await second.app.inject({
      method: "GET",
      url: "/events/evt_basement",
    });
    expect(event.json().event.tiers[0].forSale).toBe(2);

    await second.app.close();
  });

  it("does not issue the tickets twice when the log is replayed", async () => {
    const first = await start();
    await first.app.ready();
    const seller = await signUp(first.app, "seller@example.com", {
      buys: false,
      sells: true,
    });
    const admin = await signIn(first.app, ADMIN.email, ADMIN.password);
    const { payload, headers } = form({
      eventId: "evt_basement",
      tierId: "GA",
      quantity: "3",
    });
    const submitted = await first.app.inject({
      method: "POST",
      url: "/listings",
      cookies: { session: seller },
      headers,
      payload,
    });
    await first.app.inject({
      method: "POST",
      url: `/listings/${submitted.json().listing.id}/approve`,
      cookies: { session: admin },
    });

    const before = await first.app.inject({
      method: "GET",
      url: "/events/evt_basement",
    });
    const issuedBefore = before.json().event.tiers[0].issued;
    const forSaleBefore = before.json().event.tiers[0].forSale;
    await first.app.close();

    const second = await start();
    await second.app.ready();

    const after = await second.app.inject({
      method: "GET",
      url: "/events/evt_basement",
    });

    expect(after.json().event.tiers[0].issued).toBe(issuedBefore);
    expect(after.json().event.tiers[0].forSale).toBe(forSaleBefore);
    expect(second.state.listings.get(submitted.json().listing.id)?.status).toBe(
      "approved"
    );

    await second.app.close();
  });

  it("keeps a rejection and its reason", async () => {
    const first = await start();
    await first.app.ready();
    const seller = await signUp(first.app, "seller@example.com", {
      buys: false,
      sells: true,
    });
    const admin = await signIn(first.app, ADMIN.email, ADMIN.password);
    const { payload, headers } = form({
      eventId: "evt_basement",
      tierId: "GA",
      quantity: "1",
    });
    const submitted = await first.app.inject({
      method: "POST",
      url: "/listings",
      cookies: { session: seller },
      headers,
      payload,
    });
    await first.app.inject({
      method: "POST",
      url: `/listings/${submitted.json().listing.id}/reject`,
      cookies: { session: admin },
      payload: { reason: "Blurry photo" },
    });
    await first.app.close();

    const second = await start();
    await second.app.ready();

    const listing = second.state.listings.get(submitted.json().listing.id);
    expect(listing?.status).toBe("rejected");
    expect(listing?.reason).toBe("Blurry photo");

    await second.app.close();
  });

  it("carries on numbering listings after a restart", async () => {
    const first = await start();
    await first.app.ready();
    const seller = await signUp(first.app, "seller@example.com", {
      buys: false,
      sells: true,
    });
    const { payload, headers } = form({
      eventId: "evt_basement",
      tierId: "GA",
      quantity: "1",
    });
    const one = await first.app.inject({
      method: "POST",
      url: "/listings",
      cookies: { session: seller },
      headers,
      payload,
    });
    await first.app.close();

    // Accounts live in the database rather than the log, so without one
    // the seller signs up again. The listing numbering still has to carry
    // on from where the log left off.
    const second = await start();
    await second.app.ready();
    const again = await signUp(second.app, "another@example.com", {
      buys: false,
      sells: true,
    });
    const next = await second.app.inject({
      method: "POST",
      url: "/listings",
      cookies: { session: again },
      headers,
      payload: form({ eventId: "evt_basement", tierId: "GA", quantity: "1" })
        .payload,
    });

    expect(next.statusCode).toBe(201);
    expect(next.json().listing.id).not.toBe(one.json().listing.id);
    expect(second.state.listings.list()).toHaveLength(2);

    await second.app.close();
  });
});
