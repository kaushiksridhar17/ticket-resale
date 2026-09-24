import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { ExchangeState } from "../exchangeState.js";
import type { Order } from "../types.js";
import { symbolFor, type EventDefinition } from "./types.js";

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

const ID = /^evt_[a-z][a-z0-9-]*$/;
const TIER_ID = /^[A-Za-z0-9-]{1,16}$/;

export interface SeedTier {
  tierId: string;
  name: string;
  faceValueInCents: number;
  perPersonLimit: number;
  print: number;
  release: number;
}

export interface SeedEvent {
  id: string;
  name: string;
  venue: string;
  startsInDays: number;
  salesCloseHoursBefore: number;
  tiers: SeedTier[];
}

export function readSeedFile(path: string): SeedEvent[] | null {
  let raw: string;
  try {
    raw = readFileSync(resolve(path), "utf8");
  } catch {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`${path} is not valid JSON`);
  }

  const events = (parsed as { events?: unknown }).events;
  if (!Array.isArray(events)) {
    throw new Error(`${path} needs an "events" array`);
  }

  const seen = new Set<string>();
  return events.map((entry, index) => {
    const seed = checkEvent(entry, `${path} event ${index + 1}`);
    if (seen.has(seed.id)) {
      throw new Error(`${path} lists ${seed.id} twice`);
    }
    seen.add(seed.id);
    return seed;
  });
}

function checkEvent(entry: unknown, where: string): SeedEvent {
  const seed = entry as Partial<SeedEvent>;

  if (typeof seed.id !== "string" || !ID.test(seed.id)) {
    throw new Error(
      `${where} needs an id like evt_something, lowercase, starting with a letter`
    );
  }
  const name = seed.name;
  const venue = seed.venue;
  for (const [field, value] of [
    ["name", name],
    ["venue", venue],
  ] as const) {
    if (typeof value !== "string" || value.trim() === "") {
      throw new Error(`${where} needs a ${field}`);
    }
  }
  if (typeof seed.startsInDays !== "number" || seed.startsInDays <= 0) {
    throw new Error(`${where} needs startsInDays above zero`);
  }
  if (
    typeof seed.salesCloseHoursBefore !== "number" ||
    seed.salesCloseHoursBefore < 0
  ) {
    throw new Error(`${where} needs salesCloseHoursBefore of zero or more`);
  }
  if (seed.salesCloseHoursBefore >= seed.startsInDays * 24) {
    throw new Error(`${where} closes sales before it is announced`);
  }
  if (!Array.isArray(seed.tiers) || seed.tiers.length === 0) {
    throw new Error(`${where} needs at least one tier`);
  }

  const tierIds = new Set<string>();
  const tiers = seed.tiers.map((tier, index) => {
    const at = `${where} tier ${index + 1}`;
    if (typeof tier.tierId !== "string" || !TIER_ID.test(tier.tierId)) {
      throw new Error(`${at} needs a short alphanumeric tierId`);
    }
    if (tierIds.has(tier.tierId)) {
      throw new Error(`${where} lists tier ${tier.tierId} twice`);
    }
    tierIds.add(tier.tierId);

    if (typeof tier.name !== "string" || tier.name.trim() === "") {
      throw new Error(`${at} needs a name`);
    }
    const release = tier.release ?? 0;
    for (const [field, value] of [
      ["faceValueInCents", tier.faceValueInCents],
      ["perPersonLimit", tier.perPersonLimit],
      ["print", tier.print],
      ["release", release],
    ] as const) {
      if (!Number.isSafeInteger(value) || value < 0) {
        throw new Error(`${at} needs ${field} as a whole number, zero or more`);
      }
    }
    if (tier.perPersonLimit! < 1) {
      throw new Error(`${at} needs a perPersonLimit of at least one`);
    }
    if (release > tier.print!) {
      throw new Error(`${at} releases more tickets than it prints`);
    }

    return {
      tierId: tier.tierId,
      name: tier.name.trim(),
      faceValueInCents: tier.faceValueInCents,
      perPersonLimit: tier.perPersonLimit!,
      print: tier.print!,
      release,
    };
  });

  return {
    id: seed.id,
    name: (name as string).trim(),
    venue: (venue as string).trim(),
    startsInDays: seed.startsInDays,
    salesCloseHoursBefore: seed.salesCloseHoursBefore,
    tiers,
  };
}

export interface SeedResult {
  created: string[];
  skipped: string[];
}

export function seedEvents(
  state: ExchangeState,
  seeds: SeedEvent[],
  organizerId: string,
  now: number = Date.now()
): SeedResult {
  const created: string[] = [];
  const skipped: string[] = [];

  for (const seed of seeds) {
    if (state.events.get(seed.id)) {
      skipped.push(seed.id);
      continue;
    }

    const startsAt = now + seed.startsInDays * DAY;
    const event: EventDefinition = {
      id: seed.id,
      organizerId,
      name: seed.name,
      venue: seed.venue,
      startsAt,
      salesCloseAt: startsAt - seed.salesCloseHoursBefore * HOUR,
      paymentMode: "offline",
      status: "on_sale",
      tiers: seed.tiers.map((tier) => ({
        tierId: tier.tierId,
        name: tier.name,
        faceValueInCents: tier.faceValueInCents,
        perPersonLimit: tier.perPersonLimit,
      })),
    };

    state.createEvent(event);
    for (const tier of seed.tiers) {
      if (tier.print > 0) {
        state.issueTickets(seed.id, tier.tierId, tier.print);
      }
      if (tier.release > 0) {
        release(state, organizerId, seed.id, tier, now);
      }
    }

    created.push(seed.id);
  }

  return { created, skipped };
}

function release(
  state: ExchangeState,
  organizerId: string,
  eventId: string,
  tier: SeedTier,
  now: number
): void {
  const order: Order = {
    id: state.nextOrderId(),
    userId: organizerId,
    symbol: symbolFor(eventId, tier.tierId),
    side: "sell",
    type: "limit",
    priceInCents: tier.faceValueInCents,
    quantity: tier.release,
    remainingQuantity: tier.release,
    status: "open",
    sequence: 0,
    createdAt: now,
  };

  state.submitOrder(order);
}
