import type { Order } from "./types.js";

export type Command =
  | { kind: "submit"; order: Order }
  | { kind: "cancel"; symbol: string; orderId: string };