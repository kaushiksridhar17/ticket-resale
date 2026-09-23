export interface PlaceOrderBody {
  symbol: string;
  side: "buy" | "sell";
  type: "limit" | "market";
  priceInCents?: number;
  quantity: number;
  maxNotionalInCents?: number;
}

export const placeOrderSchema = {
  body: {
    type: "object",
    required: ["symbol", "side", "type", "quantity"],
    properties: {
      symbol: { type: "string", minLength: 1, maxLength: 40 },
      side: { type: "string", enum: ["buy", "sell"] },
      type: { type: "string", enum: ["limit", "market"] },
      priceInCents: { type: "integer", minimum: 1 },
      quantity: { type: "integer", minimum: 1, maximum: 1_000_000 },
      maxNotionalInCents: { type: "integer", minimum: 1 },
    },
  },
} as const;