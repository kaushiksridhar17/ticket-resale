import type { Order, OrderType, Side } from "./types.js";

let counter = 0;

export function resetOrderCounter(): void {
  counter = 0;
}

export function makeOrder(
  userId: string,
  side: Side,
  type: OrderType,
  priceInCents: number | null,
  quantity: number,
  symbol = "ACME"
): Order {
  counter += 1;
  return {
    id: `ord_${counter}`,
    userId,
    symbol,
    side,
    type,
    priceInCents,
    quantity,
    remainingQuantity: quantity,
    status: "open",
    sequence: 0,
    createdAt: 1_700_000_000_000 + counter,
  };
}