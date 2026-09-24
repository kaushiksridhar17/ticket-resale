import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { requireRole, requireUser } from "../auth/plugin.js";
import { symbolFor, type EventDefinition, type TierDefinition } from "../events/types.js";
import type { ExchangeState } from "../exchangeState.js";
import { contentTypeFor, MAX_BYTES, type EvidenceStore } from "./evidence.js";
import { ListingError, type Listing, type ListingStatus } from "./types.js";
import "@fastify/multipart";

export interface ListingRouteDeps {
  state: ExchangeState;
  evidence: EvidenceStore;
  now?: () => number;
}

const MAX_NOTE = 300;

export function registerListingRoutes(
  app: FastifyInstance,
  deps: ListingRouteDeps
): void {
  const { state, evidence } = deps;
  const now = deps.now ?? (() => Date.now());

  app.post("/listings", async (request, reply) => {
    const user = requireUser(request);
    if (user.role !== "admin" && !user.sells) {
      return reply
        .code(403)
        .send({ error: "Turn on selling in your settings first" });
    }

    let parts: SubmitParts;
    try {
      parts = await readParts(request);
    } catch (error) {
      if (error instanceof ListingError) {
        return reply.code(400).send({ error: error.message });
      }
      throw error;
    }

    const found = resolveTier(state, parts.eventId, parts.tierId);
    if (!found) {
      return reply.code(404).send({ error: "No such event or tier" });
    }
    const { event, tier } = found;

    if (event.status !== "on_sale" || now() >= event.salesCloseAt) {
      return reply
        .code(409)
        .send({ error: "That event is not taking tickets any more" });
    }

    const alreadyWaiting = state.listings.pendingQuantity(
      user.id,
      event.id,
      tier.tierId
    );
    if (alreadyWaiting + parts.quantity > tier.perPersonLimit) {
      return reply.code(422).send({
        error: `You can submit ${tier.perPersonLimit} at a time for this tier, and ${alreadyWaiting} are already waiting`,
      });
    }

    let stored: string;
    try {
      stored = evidence.save(parts.photo);
    } catch (error) {
      if (error instanceof ListingError) {
        return reply.code(400).send({ error: error.message });
      }
      throw error;
    }

    const listing: Listing = {
      id: state.nextListingId(),
      sellerId: user.id,
      eventId: event.id,
      tierId: tier.tierId,
      quantity: parts.quantity,
      note: parts.note,
      evidence: stored,
      status: "pending",
      submittedAt: now(),
      decidedAt: null,
      decidedBy: null,
      reason: null,
    };

    state.submitListing(listing);

    return reply.code(201).send({ listing: view(state, listing) });
  });

  app.get("/listings", async (request) => {
    const user = requireUser(request);
    const { status } = request.query as { status?: ListingStatus };

    const listings = state.listings.list({
      ...(user.role === "admin" ? {} : { sellerId: user.id }),
      ...(status ? { status } : {}),
    });

    return {
      listings: listings.map((listing) => view(state, listing)),
      pending: user.role === "admin" ? state.listings.countPending() : undefined,
    };
  });

  app.get("/listings/:listingId/evidence", async (request, reply) => {
    const user = requireUser(request);
    const { listingId } = request.params as { listingId: string };
    const listing = state.listings.get(listingId);

    if (!listing || (user.role !== "admin" && listing.sellerId !== user.id)) {
      return reply.code(404).send({ error: "No such listing" });
    }

    try {
      const bytes = evidence.read(listing.evidence);
      return reply
        .header("Content-Type", contentTypeFor(listing.evidence))
        .header("Cache-Control", "private, no-store")
        .send(bytes);
    } catch {
      return reply.code(404).send({ error: "That photo is missing" });
    }
  });

  app.post("/listings/:listingId/approve", async (request, reply) => {
    requireRole(request, "admin");
    return decide(request, reply, "approved", null);
  });

  app.post("/listings/:listingId/reject", async (request, reply) => {
    requireRole(request, "admin");
    const body = (request.body ?? {}) as { reason?: string };
    const reason = body.reason?.trim();
    if (!reason) {
      return reply.code(400).send({ error: "Say why you are turning it down" });
    }
    return decide(request, reply, "rejected", reason.slice(0, MAX_NOTE));
  });

  async function decide(
    request: FastifyRequest,
    reply: FastifyReply,
    status: "approved" | "rejected",
    reason: string | null
  ) {
    const admin = requireUser(request);
    const { listingId } = request.params as { listingId: string };
    const listing = state.listings.get(listingId);

    if (!listing) {
      return reply.code(404).send({ error: "No such listing" });
    }

    try {
      const decided = state.decideListing(
        listingId,
        status,
        admin.id,
        reason,
        now()
      );
      return reply.send({ listing: view(state, decided) });
    } catch (error) {
      if (error instanceof ListingError) {
        return reply.code(409).send({ error: error.message });
      }
      throw error;
    }
  }
}

interface SubmitParts {
  eventId: string;
  tierId: string;
  quantity: number;
  note: string | null;
  photo: Buffer;
}

async function readParts(request: FastifyRequest): Promise<SubmitParts> {
  if (!request.isMultipart()) {
    throw new ListingError("Send the form with the photo attached");
  }

  const fields: Record<string, string> = {};
  let photo: Buffer | null = null;

  for await (const part of request.parts()) {
    if (part.type === "file") {
      if (part.fieldname !== "photo") {
        await part.toBuffer();
        continue;
      }
      photo = await part.toBuffer();
      if (part.file.truncated) {
        throw new ListingError("Photos have to be under 5MB");
      }
    } else if (typeof part.value === "string") {
      fields[part.fieldname] = part.value;
    }
  }

  if (!photo) {
    throw new ListingError("A photo of the ticket is required");
  }

  const quantity = Number(fields.quantity ?? "1");
  if (!Number.isSafeInteger(quantity) || quantity < 1) {
    throw new ListingError("How many is not a whole number");
  }
  if (!fields.eventId || !fields.tierId) {
    throw new ListingError("Pick an event and a tier");
  }

  const note = fields.note?.trim();

  return {
    eventId: fields.eventId,
    tierId: fields.tierId,
    quantity,
    note: note ? note.slice(0, MAX_NOTE) : null,
    photo,
  };
}

function resolveTier(
  state: ExchangeState,
  eventId: string,
  tierId: string
): { event: EventDefinition; tier: TierDefinition } | null {
  const ref = state.events.resolve(symbolFor(eventId, tierId));
  return ref ? { event: ref.event, tier: ref.tier } : null;
}

function view(state: ExchangeState, listing: Listing) {
  const ref = state.events.resolve(symbolFor(listing.eventId, listing.tierId));

  return {
    id: listing.id,
    sellerId: listing.sellerId,
    eventId: listing.eventId,
    eventName: ref?.event.name ?? null,
    venue: ref?.event.venue ?? null,
    startsAt: ref?.event.startsAt ?? null,
    tierId: listing.tierId,
    tierName: ref?.tier.name ?? null,
    faceValueInCents: ref?.tier.faceValueInCents ?? null,
    quantity: listing.quantity,
    note: listing.note,
    status: listing.status,
    submittedAt: listing.submittedAt,
    decidedAt: listing.decidedAt,
    reason: listing.reason,
  };
}

export { MAX_BYTES };
