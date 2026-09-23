export interface User {
  id: string;
  email: string;
  displayName: string | null;
  role: "attendee" | "organizer" | "staff";
}

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

export interface BookLevel {
  priceInCents: number;
  totalQuantity: number;
  orderCount: number;
}

export interface OrderBookSnapshot {
  symbol: string;
  bids: BookLevel[];
  asks: BookLevel[];
  sequence: number;
}

export interface Position {
  symbol: string;
  total: number;
  locked: number;
}

export interface AccountSummary {
  userId: string;
  cash: { total: number; locked: number };
  positions: Position[];
  orders: Order[];
}

export type EventStatus = "on_sale" | "closed" | "cancelled";

export interface Tier {
  tierId: string;
  name: string;
  faceValueInCents: number;
  perPersonLimit: number;
  symbol: string;
  issued: number;
  forSale: number;
  waiting: number;
}

export interface EventSummary {
  id: string;
  organizerId: string;
  name: string;
  venue: string;
  startsAt: number;
  salesCloseAt: number;
  paymentMode: "none" | "offline";
  status: EventStatus;
  resaleOpen: boolean;
  tiers: Tier[];
}

export interface TicketSummary {
  id: string;
  symbol: string;
  serial: number;
  rotation: number;
  eventId: string | null;
  eventName: string | null;
  eventStatus: EventStatus | null;
  venue: string | null;
  startsAt: number | null;
  tierId: string | null;
  tierName: string | null;
  faceValueInCents: number | null;
}
