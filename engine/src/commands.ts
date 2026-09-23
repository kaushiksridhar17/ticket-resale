import type { EventDefinition } from "./events/types.js";
import type { Order } from "./types.js";

export type Command =
  | { kind: "createEvent"; event: EventDefinition }
  | {
      kind: "issueTickets";
      eventId: string;
      tierId: string;
      count: number;
      toUserId: string;
    }
  | { kind: "closeSales"; eventId: string }
  | { kind: "cancelEvent"; eventId: string }
  | { kind: "submit"; order: Order }
  | { kind: "admit"; ticketId: string; at: number }
  | { kind: "cancel"; symbol: string; orderId: string };
