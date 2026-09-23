import type { Order, OrderBookLevel, OrderBookSnapshot, Side } from "./types.js";

interface PriceLevel {
  priceInCents: number;
  orders: Order[];
}

export class OrderBook {
  readonly symbol: string;
  private bids: PriceLevel[] = [];
  private asks: PriceLevel[] = [];
  private ordersById = new Map<string, Order>();

  constructor(symbol: string) {
    this.symbol = symbol;
  }

  addOrder(order: Order): void {
    if (order.priceInCents === null) {
      throw new Error("Cannot rest a market order in the book");
    }
    if (order.remainingQuantity <= 0) {
      throw new Error("Cannot rest an order with no remaining quantity");
    }
    if (this.ordersById.has(order.id)) {
      throw new Error(`Order ${order.id} is already in the book`);
    }

    const levels = order.side === "buy" ? this.bids : this.asks;
    const level = this.findOrCreateLevel(levels, order.priceInCents, order.side);
    level.orders.push(order);
    this.ordersById.set(order.id, order);
  }

  removeOrder(orderId: string): Order | null {
    const order = this.ordersById.get(orderId);
    if (!order || order.priceInCents === null) {
      return null;
    }

    const levels = order.side === "buy" ? this.bids : this.asks;
    const levelIndex = levels.findIndex(
      (level) => level.priceInCents === order.priceInCents
    );
    if (levelIndex === -1) {
      return null;
    }

    const level = levels[levelIndex]!;
    const orderIndex = level.orders.findIndex((o) => o.id === orderId);
    if (orderIndex === -1) {
      return null;
    }

    level.orders.splice(orderIndex, 1);
    if (level.orders.length === 0) {
      levels.splice(levelIndex, 1);
    }
    this.ordersById.delete(orderId);
    return order;
  }

  getOrder(orderId: string): Order | null {
    return this.ordersById.get(orderId) ?? null;
  }

  bestBid(): number | null {
    return this.bids[0]?.priceInCents ?? null;
  }

  bestAsk(): number | null {
    return this.asks[0]?.priceInCents ?? null;
  }

  peekBestOrder(side: Side): Order | null {
    const levels = side === "buy" ? this.bids : this.asks;
    return levels[0]?.orders[0] ?? null;
  }

  isEmpty(side: Side): boolean {
    const levels = side === "buy" ? this.bids : this.asks;
    return levels.length === 0;
  }

  snapshot(sequence: number, depth = 10): OrderBookSnapshot {
    return {
      symbol: this.symbol,
      bids: this.aggregate(this.bids, depth),
      asks: this.aggregate(this.asks, depth),
      sequence,
    };
  }

  private findOrCreateLevel(
    levels: PriceLevel[],
    priceInCents: number,
    side: Side
  ): PriceLevel {
    const existing = levels.find((level) => level.priceInCents === priceInCents);
    if (existing) {
      return existing;
    }

    const level: PriceLevel = { priceInCents, orders: [] };
    const insertAt = levels.findIndex((other) =>
      side === "buy"
        ? priceInCents > other.priceInCents
        : priceInCents < other.priceInCents
    );

    if (insertAt === -1) {
      levels.push(level);
    } else {
      levels.splice(insertAt, 0, level);
    }
    return level;
  }

  private aggregate(levels: PriceLevel[], depth: number): OrderBookLevel[] {
    return levels.slice(0, depth).map((level) => ({
      priceInCents: level.priceInCents,
      totalQuantity: level.orders.reduce(
        (sum, order) => sum + order.remainingQuantity,
        0
      ),
      orderCount: level.orders.length,
    }));
  }
}