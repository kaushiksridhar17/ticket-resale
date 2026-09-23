export type Side = "buy" | "sell";

export type OrderType = "limit" | "market";

export type OrderStatus = "open" | "partially_filled" | "filled" | "cancelled";

export interface Order {
  id: string;
  userId: string;
  symbol: string;
  side: Side;
  type: OrderType;
  priceInCents: number | null;
  maxNotionalInCents: number | null;
  quantity: number;
  remainingQuantity: number;
  status: OrderStatus;
  sequence: number;
  createdAt: number;
}

export interface Trade {
  id: string;
  symbol: string;
  priceInCents: number;
  quantity: number;
  buyOrderId: string;
  sellOrderId: string;
  buyUserId: string;
  sellUserId: string;
  takerSide: Side;
  sequence: number;
  executedAt: number;
}

export interface OrderBookLevel {
  priceInCents: number;
  totalQuantity: number;
  orderCount: number;
}

export interface OrderBookSnapshot {
  symbol: string;
  bids: OrderBookLevel[];
  asks: OrderBookLevel[];
  sequence: number;
}