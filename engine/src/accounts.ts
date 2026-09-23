import type { Order, Trade } from "./types.js";

export interface Balance {
  total: number;
  locked: number;
}

export interface Account {
  userId: string;
  positions: Map<string, Balance>;
}

export class NothingToGive extends Error {
  constructor(userId: string, symbol: string, needed: number, available: number) {
    super(`${userId} needs ${needed} of ${symbol} but has ${available} free`);
    this.name = "NothingToGive";
  }
}

export class Accounts {
  private accounts = new Map<string, Account>();

  open(userId: string): Account {
    if (this.accounts.has(userId)) {
      throw new Error(`Account ${userId} already exists`);
    }
    const account: Account = { userId, positions: new Map() };
    this.accounts.set(userId, account);
    return account;
  }

  get(userId: string): Account {
    const account = this.accounts.get(userId);
    if (!account) {
      throw new Error(`Unknown account ${userId}`);
    }
    return account;
  }

  has(userId: string): boolean {
    return this.accounts.has(userId);
  }

  userIds(): string[] {
    return [...this.accounts.keys()];
  }

  credit(userId: string, symbol: string, quantity: number): void {
    this.position(this.get(userId), symbol).total += quantity;
  }

  available(userId: string, symbol: string): number {
    const position = this.get(userId).positions.get(symbol);
    if (!position) {
      return 0;
    }
    return position.total - position.locked;
  }

  reserve(order: Order): void {
    if (order.side === "buy") {
      return;
    }

    const position = this.position(this.get(order.userId), order.symbol);
    const available = position.total - position.locked;
    if (order.quantity > available) {
      throw new NothingToGive(
        order.userId,
        order.symbol,
        order.quantity,
        available
      );
    }
    position.locked += order.quantity;
  }

  release(order: Order, unfilledQuantity: number): void {
    if (order.side === "buy" || unfilledQuantity <= 0) {
      return;
    }
    this.position(this.get(order.userId), order.symbol).locked -=
      unfilledQuantity;
  }

  settle(trade: Trade): void {
    const buyer = this.get(trade.buyUserId);
    const seller = this.get(trade.sellUserId);

    this.position(buyer, trade.symbol).total += trade.quantity;

    const sellerPosition = this.position(seller, trade.symbol);
    sellerPosition.locked -= trade.quantity;
    sellerPosition.total -= trade.quantity;
  }

  totalHeld(symbol: string): number {
    let total = 0;
    for (const account of this.accounts.values()) {
      total += account.positions.get(symbol)?.total ?? 0;
    }
    return total;
  }

  assertInvariants(): void {
    for (const account of this.accounts.values()) {
      for (const [symbol, position] of account.positions) {
        if (position.total < 0) {
          throw new Error(`${account.userId} is short ${symbol}`);
        }
        if (position.locked < 0) {
          throw new Error(`${account.userId} has negative locked ${symbol}`);
        }
        if (position.locked > position.total) {
          throw new Error(
            `${account.userId} has more ${symbol} locked than held`
          );
        }
      }
    }
  }

  private position(account: Account, symbol: string): Balance {
    let position = account.positions.get(symbol);
    if (!position) {
      position = { total: 0, locked: 0 };
      account.positions.set(symbol, position);
    }
    return position;
  }
}
