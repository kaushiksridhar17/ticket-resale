export interface PlaceOrderBody {
  symbol: string;
  side: "buy" | "sell";
  type: "limit" | "market";
  priceInCents?: number;
  quantity: number;
}

export const placeOrderSchema = {
  body: {
    type: "object",
    required: ["symbol", "side", "type", "quantity"],
    properties: {
      symbol: { type: "string", minLength: 1, maxLength: 40 },
      side: { type: "string", enum: ["buy", "sell"] },
      type: { type: "string", enum: ["limit", "market"] },
      priceInCents: { type: "integer", minimum: 0 },
      quantity: { type: "integer", minimum: 1, maximum: 1_000_000 },
    },
  },
} as const;

export interface TierBody {
  tierId: string;
  name: string;
  faceValueInCents: number;
  perPersonLimit: number;
}

export interface CreateEventBody {
  name: string;
  venue: string;
  startsAt: number;
  salesCloseAt: number;
  paymentMode?: "none" | "offline";
  tiers: TierBody[];
}

export const createEventSchema = {
  body: {
    type: "object",
    required: ["name", "venue", "startsAt", "salesCloseAt", "tiers"],
    properties: {
      name: { type: "string", minLength: 1, maxLength: 120 },
      venue: { type: "string", minLength: 1, maxLength: 120 },
      startsAt: { type: "integer", minimum: 0 },
      salesCloseAt: { type: "integer", minimum: 0 },
      paymentMode: { type: "string", enum: ["none", "offline"] },
      tiers: {
        type: "array",
        minItems: 1,
        maxItems: 10,
        items: {
          type: "object",
          required: ["tierId", "name", "faceValueInCents", "perPersonLimit"],
          properties: {
            tierId: { type: "string", pattern: "^[A-Za-z0-9_-]{1,24}$" },
            name: { type: "string", minLength: 1, maxLength: 60 },
            faceValueInCents: { type: "integer", minimum: 0, maximum: 1_000_000 },
            perPersonLimit: { type: "integer", minimum: 1, maximum: 50 },
          },
        },
      },
    },
  },
} as const;

export interface IssueTicketsBody {
  tierId: string;
  count: number;
}

export const issueTicketsSchema = {
  body: {
    type: "object",
    required: ["tierId", "count"],
    properties: {
      tierId: { type: "string", pattern: "^[A-Za-z0-9_-]{1,24}$" },
      count: { type: "integer", minimum: 1, maximum: 100_000 },
    },
  },
} as const;
