import { Accounts, InsufficientFunds } from "./accounts.js";
import { MatchingEngine } from "./matchingEngine.js";
import type { FileEventLog } from "./eventLog.js";
import type { Order, Trade } from "./types.js";

export interface SubmitResult {
  order: Order;
  trades: Trade[];
}

export class OrderRejected extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = "OrderRejected";
  }
}

export class Exchange {
  readonly accounts: Accounts;
  readonly engine: MatchingEngine;
  private log: FileEventLog | null;

  constructor(log: FileEventLog | null = null) {
    this.accounts = new Accounts();
    this.engine = new MatchingEngine();
    this.log = log;
  }

  attachLog(log: FileEventLog): void {
    this.log = log;
  }

  submit(order: Order): SubmitResult {
    this.validate(order);

    try {
      this.accounts.reserve(order);
    } catch (error) {
      if (error instanceof InsufficientFunds) {
        throw new OrderRejected(error.message);
      }
      throw error;
    }

    this.log?.append({ kind: "submit", order: structuredClone(order) });

    const result = this.engine.submit(order);

    for (const trade of result.trades) {
      this.accounts.settle(trade);
    }

    if (order.side === "buy") {
      this.accounts.releaseBuyRemainder(order, this.stillLocked(order));
    } else if (!this.isResting(order)) {
      this.accounts.release(order, order.remainingQuantity);
    }

    return result;
  }

  cancel(symbol: string, orderId: string): Order | null {
    const order = this.engine.cancel(symbol, orderId);
    if (!order) {
      return null;
    }

    this.log?.append({ kind: "cancel", symbol, orderId });

    if (order.side === "buy" && order.priceInCents !== null) {
      this.accounts.get(order.userId).cash.locked -=
        order.priceInCents * order.remainingQuantity;
    } else {
      this.accounts.release(order, order.remainingQuantity);
    }

    return order;
  }

  private isResting(order: Order): boolean {
    return (
      order.type === "limit" &&
      (order.status === "open" || order.status === "partially_filled")
    );
  }

  private stillLocked(order: Order): number {
    if (!this.isResting(order) || order.priceInCents === null) {
      return 0;
    }
    return order.priceInCents * order.remainingQuantity;
  }

  private validate(order: Order): void {
    if (!this.accounts.has(order.userId)) {
      throw new OrderRejected(`Unknown account ${order.userId}`);
    }
    if (!Number.isInteger(order.quantity) || order.quantity <= 0) {
      throw new OrderRejected("Quantity must be a positive integer");
    }
    if (order.quantity !== order.remainingQuantity) {
      throw new OrderRejected("New order must be unfilled");
    }
    if (order.type === "limit") {
      if (order.priceInCents === null) {
        throw new OrderRejected("Limit orders require a price");
      }
      if (!Number.isInteger(order.priceInCents) || order.priceInCents < 0) {
        throw new OrderRejected("Price cannot be negative");
      }
    }
    if (order.type === "market") {
      if (order.priceInCents !== null) {
        throw new OrderRejected("Market orders must not have a price");
      }
      if (order.side === "buy" && order.maxNotionalInCents === null) {
        throw new OrderRejected("Market buys require maxNotionalInCents");
      }
    }
  }
}