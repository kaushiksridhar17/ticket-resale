export type Role = "admin" | "member";

export type Theme = "light" | "dark" | "system";

export interface User {
  id: string;
  email: string;
  displayName: string | null;
  role: Role;
  status: "active" | "suspended";
  buys: boolean;
  sells: boolean;
  theme: Theme;
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

export interface TicketPass {
  token: string;
  expiresAt: number;
  serial: number;
  symbol: string;
  admittedAt: number | null;
}

export type ScanResult =
  | {
      admitted: true;
      serial: number;
      tierName: string | null;
      owedInCents: number | null;
      admittedAt: number;
    }
  | {
      admitted: false;
      reason: string;
      message: string;
      serial?: number;
      admittedAt?: number;
    };

export interface TierReport {
  tierId: string;
  name: string;
  symbol: string;
  faceValueInCents: number;
  issued: number;
  withOrganizer: number;
  withFans: number;
  passedOn: number;
  holders: number;
  forSale: number;
  waiting: number;
  recentTrades: { priceInCents: number; quantity: number; executedAt: number }[];
}

export interface EventReport {
  event: EventSummary;
  tiers: TierReport[];
}

export interface NewTier {
  tierId: string;
  name: string;
  faceValueInCents: number;
  perPersonLimit: number;
}

export interface NewEvent {
  name: string;
  venue: string;
  startsAt: number;
  salesCloseAt: number;
  tiers: NewTier[];
}

export interface TicketSummary {
  id: string;
  symbol: string;
  serial: number;
  rotation: number;
  reserved: boolean;
  eventId: string | null;
  eventName: string | null;
  eventStatus: EventStatus | null;
  venue: string | null;
  startsAt: number | null;
  tierId: string | null;
  tierName: string | null;
  faceValueInCents: number | null;
}

export type ListingStatus = "pending" | "approved" | "rejected";

export interface ListingSummary {
  id: string;
  sellerId: string;
  eventId: string;
  eventName: string | null;
  venue: string | null;
  startsAt: number | null;
  tierId: string;
  tierName: string | null;
  faceValueInCents: number | null;
  quantity: number;
  note: string | null;
  status: ListingStatus;
  submittedAt: number;
  decidedAt: number | null;
  reason: string | null;
}
