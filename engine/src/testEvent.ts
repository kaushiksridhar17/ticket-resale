import type { ExchangeState } from "./exchangeState.js";
import { symbolFor, type EventDefinition } from "./events/types.js";

export const DEMO_EVENT_ID = "evt_demo";
export const DEMO_TIER_ID = "GA";
export const DEMO_SYMBOL = symbolFor(DEMO_EVENT_ID, DEMO_TIER_ID);

export interface DemoEventOptions {
  eventId?: string;
  tierId?: string;
  organizerId?: string;
  faceValueInCents?: number;
  perPersonLimit?: number;
  salesCloseAt?: number;
  paymentMode?: "none" | "offline";
}

export function demoEvent(options: DemoEventOptions = {}): EventDefinition {
  return {
    id: options.eventId ?? DEMO_EVENT_ID,
    organizerId: options.organizerId ?? "organizer",
    name: "Demo night",
    venue: "The Hall",
    startsAt: 4_000_000_000_000,
    salesCloseAt: options.salesCloseAt ?? 3_999_000_000_000,
    paymentMode: options.paymentMode ?? "offline",
    status: "on_sale",
    tiers: [
      {
        tierId: options.tierId ?? DEMO_TIER_ID,
        name: "General admission",
        faceValueInCents: options.faceValueInCents ?? 6000,
        perPersonLimit: options.perPersonLimit ?? 10_000,
      },
    ],
  };
}

export function seedEvent(
  state: ExchangeState,
  options: DemoEventOptions & { issueTo?: string[]; count?: number } = {}
): string {
  const event = demoEvent(options);
  state.createEvent(event);

  const tierId = event.tiers[0]!.tierId;
  for (const holder of options.issueTo ?? []) {
    state.issueTickets(event.id, tierId, options.count ?? 1000, holder);
  }

  return symbolFor(event.id, tierId);
}
