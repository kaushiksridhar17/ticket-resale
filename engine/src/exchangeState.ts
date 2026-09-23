import { Exchange, OrderRejected, type SubmitResult } from "./exchange.js";
import { FileEventLog, type LogEntry } from "./eventLog.js";
import { EventRegistry } from "./events/registry.js";
import { symbolFor, type EventDefinition } from "./events/types.js";
import type { Command } from "./commands.js";
import type { Order, Trade } from "./types.js";

const STARTING_CASH = 100_000_00;

export interface PersistenceTarget {
  enqueue(logSeq: number, trades: Trade[], orders: Order[]): void;
}

export interface ExchangeStateOptions {
  persistence?: PersistenceTarget | null;
  lastPersistedLogSeq?: number;
  now?: () => number;
}

export class ExchangeState {
  readonly exchange: Exchange;
  readonly events = new EventRegistry();
  private readonly log: FileEventLog | null;
  private readonly persistence: PersistenceTarget | null;
  private readonly lastPersistedLogSeq: number;
  private readonly now: () => number;
  private orders = new Map<string, Order>();
  private trades: Trade[] = [];
  private orderCounter = 0;
  private recoveredCount = 0;
  private requeuedCount = 0;

  constructor(logPath: string | null, options: ExchangeStateOptions = {}) {
    this.log = logPath === null ? null : new FileEventLog(logPath);
    this.persistence = options.persistence ?? null;
    this.lastPersistedLogSeq = options.lastPersistedLogSeq ?? 0;
    this.now = options.now ?? (() => Date.now());
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
    return this.events.symbols();
  }

  isValidSymbol(symbol: string): boolean {
    return this.events.isValidSymbol(symbol);
  }

  ensureAccount(userId: string): void {
    if (this.exchange.accounts.has(userId)) {
      return;
    }
    this.exchange.accounts.open(userId, STARTING_CASH);
  }

  nextOrderId(): string {
    this.orderCounter += 1;
    return `ord_${this.orderCounter}`;
  }

  createEvent(event: EventDefinition): EventDefinition {
    this.events.create(event);
    this.ensureAccount(event.organizerId);
    this.log?.append({ kind: "createEvent", event: structuredClone(event) });
    return event;
  }

  issueTickets(
    eventId: string,
    tierId: string,
    count: number,
    toUserId?: string
  ): number {
    const symbol = symbolFor(eventId, tierId);
    const ref = this.events.resolve(symbol);
    if (!ref) {
      throw new OrderRejected(`Unknown ticket type ${symbol}`);
    }
    if (!Number.isInteger(count) || count <= 0) {
      throw new OrderRejected("Ticket count must be a positive integer");
    }

    const holder = toUserId ?? ref.event.organizerId;
    this.ensureAccount(holder);
    this.exchange.accounts.credit(holder, symbol, count);
    this.events.recordIssued(symbol, count);
    this.log?.append({
      kind: "issueTickets",
      eventId,
      tierId,
      count,
      toUserId: holder,
    });

    return this.events.issuedCount(symbol);
  }

  closeSales(eventId: string): EventDefinition | null {
    const event = this.events.setStatus(eventId, "closed");
    if (!event) {
      return null;
    }
    this.cancelResting(eventId);
    this.log?.append({ kind: "closeSales", eventId });
    return event;
  }

  cancelEvent(eventId: string): EventDefinition | null {
    const event = this.events.setStatus(eventId, "cancelled");
    if (!event) {
      return null;
    }
    this.cancelResting(eventId);
    this.log?.append({ kind: "cancelEvent", eventId });
    return event;
  }

  submitOrder(order: Order): SubmitResult {
    this.checkTicketRules(order);
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

  heldTickets(userId: string, symbol: string): number {
    if (!this.exchange.accounts.has(userId)) {
      return 0;
    }
    return this.exchange.accounts.get(userId).positions.get(symbol)?.total ?? 0;
  }

  openBuyQuantity(userId: string, symbol: string): number {
    let total = 0;
    for (const order of this.orders.values()) {
      if (
        order.userId === userId &&
        order.symbol === symbol &&
        order.side === "buy" &&
        (order.status === "open" || order.status === "partially_filled")
      ) {
        total += order.remainingQuantity;
      }
    }
    return total;
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

  restingOrders(symbol: string): Order[] {
    return [...this.orders.values()].filter(
      (order) =>
        order.symbol === symbol &&
        (order.status === "open" || order.status === "partially_filled")
    );
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

  private checkTicketRules(order: Order): void {
    const ref = this.events.resolve(order.symbol);
    if (!ref) {
      throw new OrderRejected(`Unknown ticket type ${order.symbol}`);
    }

    const { event, tier } = ref;
    if (event.status === "cancelled") {
      throw new OrderRejected("This event has been cancelled");
    }
    if (event.status === "closed" || this.now() >= event.salesCloseAt) {
      throw new OrderRejected("Resale has closed for this event");
    }
    if (order.type !== "limit") {
      throw new OrderRejected("Tickets can only be bought and sold at a set price");
    }
    if (order.priceInCents === null || order.priceInCents > tier.faceValueInCents) {
      throw new OrderRejected(
        `Tickets cannot change hands above face value`
      );
    }

    if (order.side === "buy") {
      const held = this.heldTickets(order.userId, order.symbol);
      const pending = this.openBuyQuantity(order.userId, order.symbol);
      if (held + pending + order.quantity > tier.perPersonLimit) {
        throw new OrderRejected(
          `You can hold at most ${tier.perPersonLimit} tickets for this event`
        );
      }
    }
  }

  private cancelResting(eventId: string): void {
    for (const order of [...this.orders.values()]) {
      if (
        order.symbol.startsWith(`${eventId}:`) &&
        (order.status === "open" || order.status === "partially_filled")
      ) {
        const cancelled = this.exchange.cancel(order.symbol, order.id);
        if (cancelled) {
          this.persistence?.enqueue(this.logPosition(), [], [cancelled]);
        }
      }
    }
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
      const command: Command = entry.command;
      const shouldPersist = entry.seq > this.lastPersistedLogSeq;

      if (command.kind === "createEvent") {
        this.events.create(command.event);
        this.ensureAccount(command.event.organizerId);
        continue;
      }

      if (command.kind === "issueTickets") {
        const symbol = symbolFor(command.eventId, command.tierId);
        this.ensureAccount(command.toUserId);
        this.exchange.accounts.credit(command.toUserId, symbol, command.count);
        this.events.recordIssued(symbol, command.count);
        continue;
      }

      if (command.kind === "closeSales") {
        this.events.setStatus(command.eventId, "closed");
        continue;
      }

      if (command.kind === "cancelEvent") {
        this.events.setStatus(command.eventId, "cancelled");
        continue;
      }

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
