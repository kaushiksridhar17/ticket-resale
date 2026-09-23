import type { Order, Trade } from "./types.js";

export interface Balance {
  total: number;
  locked: number;
}

export interface Account {
  userId: string;
  cash: Balance;
  positions: Map<string, Balance>;
}

export class InsufficientFunds extends Error {
  constructor(userId: string, needed: number, available: number) {
    super(`${userId} needs ${needed} but has ${available} available`);
    this.name = "InsufficientFunds";
  }
}

export class Accounts {
  private accounts = new Map<string, Account>();

  open(userId: string, startingCashInCents: number): Account {
    if (this.accounts.has(userId)) {
      throw new Error(`Account ${userId} already exists`);
    }
    const account: Account = {
      userId,
      cash: { total: startingCashInCents, locked: 0 },
      positions: new Map(),
    };
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

  credit(userId: string, symbol: string, quantity: number): void {
    const position = this.position(this.get(userId), symbol);
    position.total += quantity;
  }

  availableCash(userId: string): number {
    const { cash } = this.get(userId);
    return cash.total - cash.locked;
  }

  availableShares(userId: string, symbol: string): number {
    const position = this.get(userId).positions.get(symbol);
    if (!position) {
      return 0;
    }
    return position.total - position.locked;
  }

  buyReservation(order: Order): number {
    if (order.priceInCents !== null) {
      return order.priceInCents * order.quantity;
    }
    if (order.maxNotionalInCents === null) {
      throw new Error("A market buy requires maxNotionalInCents");
    }
    return order.maxNotionalInCents;
  }

  reserve(order: Order): void {
    const account = this.get(order.userId);

    if (order.side === "buy") {
      const needed = this.buyReservation(order);
      const available = account.cash.total - account.cash.locked;
      if (needed > available) {
        throw new InsufficientFunds(order.userId, needed, available);
      }
      account.cash.locked += needed;
      return;
    }

    const position = this.position(account, order.symbol);
    const available = position.total - position.locked;
    if (order.quantity > available) {
      throw new InsufficientFunds(order.userId, order.quantity, available);
    }
    position.locked += order.quantity;
  }

  release(order: Order, unfilledQuantity: number): void {
    if (order.side === "buy") {
      return;
    }
    if (unfilledQuantity <= 0) {
      return;
    }
    this.position(this.get(order.userId), order.symbol).locked -=
      unfilledQuantity;
  }

    releaseBuyRemainder(order: Order, stillReservedInCents: number): void {
    const account = this.get(order.userId);
    const reserved = this.buyReservation(order);
    account.cash.locked -= reserved - stillReservedInCents;
  }

  settle(trade: Trade): void {
    const buyer = this.get(trade.buyUserId);
    const seller = this.get(trade.sellUserId);
    const value = trade.priceInCents * trade.quantity;

    buyer.cash.total -= value;
    this.position(buyer, trade.symbol).total += trade.quantity;

    const sellerPosition = this.position(seller, trade.symbol);
    sellerPosition.locked -= trade.quantity;
    sellerPosition.total -= trade.quantity;
    seller.cash.total += value;
  }

  totalCash(): number {
    let total = 0;
    for (const account of this.accounts.values()) {
      total += account.cash.total;
    }
    return total;
  }

  totalShares(symbol: string): number {
    let total = 0;
    for (const account of this.accounts.values()) {
      total += account.positions.get(symbol)?.total ?? 0;
    }
    return total;
  }

  assertInvariants(): void {
    for (const account of this.accounts.values()) {
      if (account.cash.total < 0) {
        throw new Error(`${account.userId} has negative cash`);
      }
      if (account.cash.locked < 0) {
        throw new Error(`${account.userId} has negative locked cash`);
      }
      if (account.cash.locked > account.cash.total) {
        throw new Error(`${account.userId} has more cash locked than held`);
      }
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