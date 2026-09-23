export type PaymentMode = "none" | "offline";
export type EventStatus = "on_sale" | "closed" | "cancelled";

export interface TierDefinition {
  tierId: string;
  name: string;
  faceValueInCents: number;
  perPersonLimit: number;
}

export interface EventDefinition {
  id: string;
  organizerId: string;
  name: string;
  venue: string;
  startsAt: number;
  salesCloseAt: number;
  paymentMode: PaymentMode;
  status: EventStatus;
  tiers: TierDefinition[];
}

export interface TierRef {
  event: EventDefinition;
  tier: TierDefinition;
}

export function symbolFor(eventId: string, tierId: string): string {
  return `${eventId}:${tierId}`;
}

export function parseSymbol(
  symbol: string
): { eventId: string; tierId: string } | null {
  const separator = symbol.indexOf(":");
  if (separator <= 0 || separator === symbol.length - 1) {
    return null;
  }
  return {
    eventId: symbol.slice(0, separator),
    tierId: symbol.slice(separator + 1),
  };
}
