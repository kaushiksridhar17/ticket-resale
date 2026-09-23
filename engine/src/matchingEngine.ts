import { createHash } from "node:crypto";
import { OrderBook } from "./orderBook.js";
import type { Order, Trade } from "./types.js";

export interface MatchResult {
  order: Order;
  trades: Trade[];
}

export class MatchingEngine {
  private books = new Map<string, OrderBook>();
  private sequence = 0;
  private tradeCounter = 0;

  submit(order: Order): MatchResult {
    const book = this.bookFor(order.symbol);
    this.sequence += 1;
    order.sequence = this.sequence;

    const trades = this.match(order, book);

    if (order.remainingQuantity === 0) {
      order.status = "filled";
    } else if (order.type === "market") {
      order.status = trades.length > 0 ? "partially_filled" : "cancelled";
    } else {
      order.status = trades.length > 0 ? "partially_filled" : "open";
      book.addOrder(order);
    }

    return { order, trades };
  }

  cancel(symbol: string, orderId: string): Order | null {
    const book = this.books.get(symbol);
    if (!book) {
      return null;
    }
    const order = book.removeOrder(orderId);
    if (order) {
      order.status = "cancelled";
    }
    return order;
  }

  snapshot(symbol: string, depth = 10) {
    return this.bookFor(symbol).snapshot(this.sequence, depth);
  }

  symbols(): string[] {
    return [...this.books.keys()].sort();
  }

  digest(): string {
    const state = this.symbols().map((symbol) =>
      this.snapshot(symbol, Number.MAX_SAFE_INTEGER)
    );
    return createHash("sha256").update(JSON.stringify(state)).digest("hex");
  }

  private match(taker: Order, book: OrderBook): Trade[] {
    const trades: Trade[] = [];
    const oppositeSide = taker.side === "buy" ? "sell" : "buy";

    while (taker.remainingQuantity > 0) {
      const maker = book.peekBestOrder(oppositeSide);
      if (!maker || maker.priceInCents === null) {
        break;
      }
      if (!this.pricesCross(taker, maker.priceInCents)) {
        break;
      }
      if (maker.userId === taker.userId) {
        break;
      }

      const quantity = Math.min(taker.remainingQuantity, maker.remainingQuantity);
      taker.remainingQuantity -= quantity;
      maker.remainingQuantity -= quantity;

      trades.push(this.createTrade(taker, maker, maker.priceInCents, quantity));

      if (maker.remainingQuantity === 0) {
        maker.status = "filled";
        book.removeOrder(maker.id);
      } else {
        maker.status = "partially_filled";
      }
    }

    return trades;
  }

  private pricesCross(taker: Order, makerPriceInCents: number): boolean {
    if (taker.type === "market") {
      return true;
    }
    if (taker.priceInCents === null) {
      return false;
    }
    return taker.side === "buy"
      ? taker.priceInCents >= makerPriceInCents
      : taker.priceInCents <= makerPriceInCents;
  }

  private createTrade(
    taker: Order,
    maker: Order,
    priceInCents: number,
    quantity: number
  ): Trade {
    this.tradeCounter += 1;
    this.sequence += 1;

    const buyOrder = taker.side === "buy" ? taker : maker;
    const sellOrder = taker.side === "buy" ? maker : taker;

    return {
      id: `trd_${this.tradeCounter}`,
      symbol: taker.symbol,
      priceInCents,
      quantity,
      buyOrderId: buyOrder.id,
      sellOrderId: sellOrder.id,
      buyUserId: buyOrder.userId,
      sellUserId: sellOrder.userId,
      takerSide: taker.side,
      sequence: this.sequence,
      executedAt: taker.createdAt,
    };
  }

  private bookFor(symbol: string): OrderBook {
    let book = this.books.get(symbol);
    if (!book) {
      book = new OrderBook(symbol);
      this.books.set(symbol, book);
    }
    return book;
  }
}