import { Exchange, type SubmitResult } from "./exchange.js";
import { FileEventLog, type LogEntry } from "./eventLog.js";
import type { Order, Trade } from "./types.js";

const SYMBOLS = ["ACME", "ZENX", "ORBT"];
const STARTING_CASH = 100_000_00;
const STARTING_SHARES = 1000;

export interface PersistenceTarget {
  enqueue(logSeq: number, trades: Trade[], orders: Order[]): void;
}

export interface ExchangeStateOptions {
  persistence?: PersistenceTarget | null;
  lastPersistedLogSeq?: number;
}

export class ExchangeState {
  readonly exchange: Exchange;
  private readonly log: FileEventLog | null;
  private readonly persistence: PersistenceTarget | null;
  private readonly lastPersistedLogSeq: number;
  private orders = new Map<string, Order>();
  private trades: Trade[] = [];
  private orderCounter = 0;
  private recoveredCount = 0;
  private requeuedCount = 0;

  constructor(logPath: string | null, options: ExchangeStateOptions = {}) {
    this.log = logPath === null ? null : new FileEventLog(logPath);
    this.persistence = options.persistence ?? null;
    this.lastPersistedLogSeq = options.lastPersistedLogSeq ?? 0;
    this.exchange = new Exchange(null);

    if (this.log !== null) {
      this.recover(this.log.readAll());
      this.exchange.attachLog(this.log);
    }
  }

  get recovered(): number {
    return this.recoveredCount;
  }

  get requeuedForDatabase(): number {
    return this.requeuedCount;
  }

  logPosition(): number {
    return this.log?.size() ?? 0;
  }

  symbols(): string[] {
    return [...SYMBOLS];
  }

  isValidSymbol(symbol: string): boolean {
    return SYMBOLS.includes(symbol);
  }

  ensureAccount(userId: string): void {
    if (this.exchange.accounts.has(userId)) {
      return;
    }
    const isBot = userId.startsWith("mm_") || userId.startsWith("noise_");
    const cash = isBot ? STARTING_CASH * 500 : STARTING_CASH;
    const shares = isBot ? STARTING_SHARES * 500 : STARTING_SHARES;

    this.exchange.accounts.open(userId, cash);
    for (const symbol of SYMBOLS) {
      this.exchange.accounts.credit(userId, symbol, shares);
    }
  }

  nextOrderId(): string {
    this.orderCounter += 1;
    return `ord_${this.orderCounter}`;
  }

  submitOrder(order: Order): SubmitResult {
    const result = this.apply(order);
    this.persist(this.logPosition(), result.order, result.trades);
    return result;
  }

  cancelOrder(symbol: string, orderId: string): Order | null {
    const order = this.exchange.cancel(symbol, orderId);
    if (order) {
      this.persistence?.enqueue(this.logPosition(), [], [order]);
    }
    return order;
  }

  recordOrder(order: Order): void {
    this.orders.set(order.id, order);
  }

  recordTrades(trades: Trade[]): void {
    this.trades.push(...trades);
    if (this.trades.length > 5000) {
      this.trades = this.trades.slice(-5000);
    }
  }

  getOrder(orderId: string): Order | null {
    return this.orders.get(orderId) ?? null;
  }

  ordersFor(userId: string): Order[] {
    return [...this.orders.values()].filter((order) => order.userId === userId);
  }

  recentTrades(symbol: string, limit = 50): Trade[] {
    return this.trades
      .filter((trade) => trade.symbol === symbol)
      .slice(-limit)
      .reverse();
  }

  close(): void {
    this.log?.close();
  }

  private apply(order: Order): SubmitResult {
    const result = this.exchange.submit(order);
    this.recordOrder(result.order);
    this.recordTrades(result.trades);
    return result;
  }

  private persist(logSeq: number, taker: Order, trades: Trade[]): void {
    if (!this.persistence) {
      return;
    }

    const touched = new Map<string, Order>([[taker.id, taker]]);
    for (const trade of trades) {
      for (const orderId of [trade.buyOrderId, trade.sellOrderId]) {
        const order = this.orders.get(orderId);
        if (order) {
          touched.set(orderId, order);
        }
      }
    }

    this.persistence.enqueue(logSeq, trades, [...touched.values()]);
  }

  private recover(entries: LogEntry[]): void {
    let highestCounter = 0;

    for (const entry of entries) {
      const command = entry.command;
      const shouldPersist = entry.seq > this.lastPersistedLogSeq;

      if (command.kind === "cancel") {
        const cancelled = this.exchange.cancel(command.symbol, command.orderId);
        if (cancelled && shouldPersist && this.persistence) {
          this.persistence.enqueue(entry.seq, [], [cancelled]);
          this.requeuedCount += 1;
        }
        continue;
      }

      const order = structuredClone(command.order);
      const match = /^ord_(\d+)$/.exec(order.id);
      if (match) {
        highestCounter = Math.max(highestCounter, Number(match[1]));
      }

      this.ensureAccount(order.userId);

      try {
        const result = this.apply(order);
        if (shouldPersist && this.persistence) {
          this.persist(entry.seq, result.order, result.trades);
          this.requeuedCount += 1;
        }
      } catch {
        continue;
      }
    }

    this.orderCounter = highestCounter;
    this.recoveredCount = entries.length;
  }
}