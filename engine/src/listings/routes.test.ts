import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildServer } from "../server.js";
import { signIn, signUp, userIdFor } from "../testAuth.js";
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
  Buffer.alloc(64, 7),
]);
const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(64, 3),
]);

function form(
  fields: Record<string, string>,
  photo: Buffer | null,
  filename = "ticket.jpg"
) {
  const boundary = "----facevaluetest";
  const parts: Buffer[] = [];

  for (const [name, value] of Object.entries(fields)) {
    parts.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`
      )
    );
  }
  if (photo) {
    parts.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="photo"; filename="${filename}"\r\nContent-Type: image/jpeg\r\n\r\n`
      ),
      photo,
      Buffer.from("\r\n")
    );
  }
  parts.push(Buffer.from(`--${boundary}--\r\n`));

  return {
    payload: Buffer.concat(parts),
    headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
  };
}

describe("seller listings", () => {
  let app: FastifyInstance;
  let dir: string;
  let admin: string;
  let seller: string;
  let sellerId: string;
  let customer: string;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), "facevalue-evidence-"));
    const built = await buildServer({
      logPath: null,
      authPepper: "test-pepper",
      admin: ADMIN,
      seed: CATALOGUE,
      evidencePath: dir,
    });
    app = built.app;
    await app.ready();

    admin = await signIn(app, ADMIN.email, ADMIN.password);
    seller = await signUp(app, "seller@example.com", { buys: false, sells: true });
    sellerId = await userIdFor(app, seller);
    customer = await signUp(app, "customer@example.com", { buys: true, sells: false });
  });

  afterEach(async () => {
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  });

  function submit(
    session: string,
    overrides: Record<string, string> = {},
    photo: Buffer | null = JPEG
  ) {
    const { payload, headers } = form(
      {
        eventId: "evt_basement",
        tierId: "GA",
        quantity: "1",
        ...overrides,
      },
      photo
    );
    return app.inject({
      method: "POST",
      url: "/listings",
      cookies: { session },
      headers,
      payload,
    });
  }

  it("takes a listing from a seller and leaves it pending", async () => {
    const response = await submit(seller, { quantity: "2", note: "Row J" });

    expect(response.statusCode).toBe(201);
    expect(response.json().listing).toMatchObject({
      status: "pending",
      quantity: 2,
      eventName: "Basement show",
      tierName: "Standing",
      faceValueInCents: 1500,
      note: "Row J",
    });
  });

  it("puts no tickets into the world until somebody approves", async () => {
    await submit(seller);

    const tickets = await app.inject({
      method: "GET",
      url: "/tickets",
      cookies: { session: seller },
    });
    expect(tickets.json().tickets).toEqual([]);

    const event = await app.inject({ method: "GET", url: "/events/evt_basement" });
    expect(event.json().event.tiers[0].forSale).toBe(0);
  });

  it("refuses a listing from an account that does not sell", async () => {
    const response = await submit(customer);

    expect(response.statusCode).toBe(403);
  });

  it("refuses a listing from nobody at all", async () => {
    const { payload, headers } = form(
      { eventId: "evt_basement", tierId: "GA", quantity: "1" },
      JPEG
    );
    const response = await app.inject({
      method: "POST",
      url: "/listings",
      headers,
      payload,
    });

    expect(response.statusCode).toBe(401);
  });

  it("insists on a photo", async () => {
    const response = await submit(seller, {}, null);

    expect(response.statusCode).toBe(400);
    expect(response.json().error).toMatch(/photo/i);
  });

  it("refuses a file that is not an image whatever it is called", async () => {
    const response = await submit(seller, {}, Buffer.from("#!/bin/sh\nrm -rf /"));

    expect(response.statusCode).toBe(400);
    expect(response.json().error).toMatch(/JPEG/);
  });

  it("takes a PNG as happily as a JPEG", async () => {
    const response = await submit(seller, {}, PNG);

    expect(response.statusCode).toBe(201);
  });

  it("refuses an event that does not exist", async () => {
    const response = await submit(seller, { eventId: "evt_nope" });

    expect(response.statusCode).toBe(404);
  });

  it("refuses a tier that does not exist", async () => {
    const response = await submit(seller, { tierId: "VIP" });

    expect(response.statusCode).toBe(404);
  });

  it("refuses to take more than the per person limit at once", async () => {
    await submit(seller, { quantity: "3" });
    const response = await submit(seller, { quantity: "2" });

    expect(response.statusCode).toBe(422);
    expect(response.json().error).toMatch(/already waiting/);
  });

  it("refuses a listing once the event has closed", async () => {
    await app.inject({
      method: "POST",
      url: "/events/evt_basement/close",
      cookies: { session: admin },
    });

    const response = await submit(seller);

    expect(response.statusCode).toBe(409);
  });

  it("shows a seller their own listings and nobody else's", async () => {
    await submit(seller);

    const mine = await app.inject({
      method: "GET",
      url: "/listings",
      cookies: { session: seller },
    });
    const theirs = await app.inject({
      method: "GET",
      url: "/listings",
      cookies: { session: customer },
    });

    expect(mine.json().listings).toHaveLength(1);
    expect(theirs.json().listings).toEqual([]);
  });

  it("shows an admin everything waiting", async () => {
    await submit(seller);
    const other = await signUp(app, "other@example.com", {
      buys: false,
      sells: true,
    });
    await submit(other);

    const queue = await app.inject({
      method: "GET",
      url: "/listings?status=pending",
      cookies: { session: admin },
    });

    expect(queue.json().listings).toHaveLength(2);
    expect(queue.json().pending).toBe(2);
  });

  it("hands the photo to the seller who sent it and to the admin", async () => {
    const { listing } = (await submit(seller)).json();

    for (const session of [seller, admin]) {
      const response = await app.inject({
        method: "GET",
        url: `/listings/${listing.id}/evidence`,
        cookies: { session },
      });
      expect(response.statusCode).toBe(200);
      expect(response.headers["content-type"]).toBe("image/jpeg");
      expect(response.rawPayload.length).toBe(JPEG.length);
    }
  });

  it("does not hand the photo to anybody else", async () => {
    const { listing } = (await submit(seller)).json();

    const response = await app.inject({
      method: "GET",
      url: `/listings/${listing.id}/evidence`,
      cookies: { session: customer },
    });

    expect(response.statusCode).toBe(404);
  });

  it("does not hand the photo out without a session", async () => {
    const { listing } = (await submit(seller)).json();

    const response = await app.inject({
      method: "GET",
      url: `/listings/${listing.id}/evidence`,
    });

    expect(response.statusCode).toBe(401);
  });

  it("puts the tickets on sale at face value when approved", async () => {
    const { listing } = (await submit(seller, { quantity: "2" })).json();

    const approved = await app.inject({
      method: "POST",
      url: `/listings/${listing.id}/approve`,
      cookies: { session: admin },
    });

    expect(approved.statusCode).toBe(200);
    expect(approved.json().listing.status).toBe("approved");

    const tickets = await app.inject({
      method: "GET",
      url: "/tickets",
      cookies: { session: seller },
    });
    expect(tickets.json().tickets).toHaveLength(2);

    const event = await app.inject({ method: "GET", url: "/events/evt_basement" });
    expect(event.json().event.tiers[0].forSale).toBe(2);
  });

  it("lets a customer buy an approved ticket at face value", async () => {
    const { listing } = (await submit(seller)).json();
    await app.inject({
      method: "POST",
      url: `/listings/${listing.id}/approve`,
      cookies: { session: admin },
    });

    const bought = await app.inject({
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

    expect(bought.json().trades).toHaveLength(1);
    expect(bought.json().trades[0].priceInCents).toBe(1500);
    expect(bought.json().trades[0].sellUserId).toBe(sellerId);
  });

  it("issues nothing when rejected, and says why", async () => {
    const { listing } = (await submit(seller)).json();

    const rejected = await app.inject({
      method: "POST",
      url: `/listings/${listing.id}/reject`,
      cookies: { session: admin },
      payload: { reason: "The photo is of a different event" },
    });

    expect(rejected.statusCode).toBe(200);
    expect(rejected.json().listing).toMatchObject({
      status: "rejected",
      reason: "The photo is of a different event",
    });

    const tickets = await app.inject({
      method: "GET",
      url: "/tickets",
      cookies: { session: seller },
    });
    expect(tickets.json().tickets).toEqual([]);
  });

  it("insists on a reason for turning one down", async () => {
    const { listing } = (await submit(seller)).json();

    const response = await app.inject({
      method: "POST",
      url: `/listings/${listing.id}/reject`,
      cookies: { session: admin },
      payload: { reason: "   " },
    });

    expect(response.statusCode).toBe(400);
  });

  it("refuses to let a seller approve their own listing", async () => {
    const { listing } = (await submit(seller)).json();

    const response = await app.inject({
      method: "POST",
      url: `/listings/${listing.id}/approve`,
      cookies: { session: seller },
    });

    expect(response.statusCode).toBe(403);
  });

  it("refuses to decide the same listing twice", async () => {
    const { listing } = (await submit(seller)).json();

    await app.inject({
      method: "POST",
      url: `/listings/${listing.id}/approve`,
      cookies: { session: admin },
    });
    const again = await app.inject({
      method: "POST",
      url: `/listings/${listing.id}/reject`,
      cookies: { session: admin },
      payload: { reason: "Changed my mind" },
    });

    expect(again.statusCode).toBe(409);
  });

  it("returns 404 for a listing that does not exist", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/listings/lst_999/approve",
      cookies: { session: admin },
    });

    expect(response.statusCode).toBe(404);
  });
});
