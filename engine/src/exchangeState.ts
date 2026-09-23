import { Exchange, OrderRejected, type SubmitResult } from "./exchange.js";
import { FileEventLog, type LogEntry } from "./eventLog.js";
import { EventRegistry } from "./events/registry.js";
import { symbolFor, type EventDefinition } from "./events/types.js";
import { TicketRegistry } from "./tickets/registry.js";
import type { Ticket, TicketTransfer } from "./tickets/types.js";
import type { PersistenceChanges } from "./db/writer.js";
import type { Command } from "./commands.js";
import type { Order, Side, Trade } from "./types.js";

const STARTING_CASH = 100_000_00;

export interface PersistenceTarget {
  enqueue(logSeq: number, changes: PersistenceChanges): void;
}

interface AppliedOrder {
  result: SubmitResult;
  tickets: Ticket[];
  transfers: TicketTransfer[];
}

export interface ExchangeStateOptions {
  persistence?: PersistenceTarget | null;
  lastPersistedLogSeq?: number;
  now?: () => number;
}

export class ExchangeState {
  readonly exchange: Exchange;
  readonly events = new EventRegistry();
  readonly tickets = new TicketRegistry();
  private readonly log: FileEventLog | null;
  private readonly persistence: PersistenceTarget | null;
  private readonly lastPersistedLogSeq: number;
  private readonly now: () => number;
  private orders = new Map<string, Order>();
  private trades: Trade[] = [];
  private orderCounter = 0;
  private eventCounter = 0;
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

  nextEventId(): string {
    this.eventCounter += 1;
    return `evt_${this.eventCounter}`;
  }

  createEvent(event: EventDefinition): EventDefinition {
    this.events.create(event);
    this.ensureAccount(event.organizerId);
    this.log?.append({ kind: "createEvent", event: structuredClone(event) });
    this.persistence?.enqueue(this.logPosition(), { events: [event] });
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
    const issued = this.tickets.issue(symbol, count, holder);
    this.events.recordIssued(symbol, count);
    this.log?.append({
      kind: "issueTickets",
      eventId,
      tierId,
      count,
      toUserId: holder,
    });
    this.persistIssued(this.logPosition(), issued);

    return this.events.issuedCount(symbol);
  }

  closeSales(eventId: string): EventDefinition | null {
    const event = this.events.setStatus(eventId, "closed");
    if (!event) {
      return null;
    }
    this.cancelResting(eventId);
    this.log?.append({ kind: "closeSales", eventId });
    this.persistence?.enqueue(this.logPosition(), { events: [event] });
    return event;
  }

  cancelEvent(eventId: string): EventDefinition | null {
    const event = this.events.setStatus(eventId, "cancelled");
    if (!event) {
      return null;
    }
    this.cancelResting(eventId);
    this.log?.append({ kind: "cancelEvent", eventId });
    this.persistence?.enqueue(this.logPosition(), { events: [event] });
    return event;
  }

  submitOrder(order: Order): SubmitResult {
    this.checkTicketRules(order);
    const applied = this.apply(order);
    this.persist(this.logPosition(), applied);
    return applied.result;
  }

  cancelOrder(symbol: string, orderId: string): Order | null {
    const order = this.exchange.cancel(symbol, orderId);
    if (order) {
      this.persistence?.enqueue(this.logPosition(), { orders: [order] });
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

  restingQuantity(symbol: string, side: Side): number {
    let total = 0;
    for (const order of this.orders.values()) {
      if (
        order.symbol === symbol &&
        order.side === side &&
        (order.status === "open" || order.status === "partially_filled")
      ) {
        total += order.remainingQuantity;
      }
    }
    return total;
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

  ticketsHeldBy(userId: string, symbol?: string): Ticket[] {
    return this.tickets.heldBy(userId, symbol);
  }

  getTicket(ticketId: string): Ticket | null {
    return this.tickets.get(ticketId);
  }

  assertInvariants(): void {
    this.exchange.accounts.assertInvariants();
    this.tickets.assertInvariants();

    for (const symbol of this.events.symbols()) {
      const issued = this.events.issuedCount(symbol);
      if (this.exchange.accounts.totalShares(symbol) !== issued) {
        throw new Error(`Ticket count for ${symbol} does not match issuance`);
      }
      if (this.tickets.issuedCount(symbol) !== issued) {
        throw new Error(`Ticket registry for ${symbol} does not match issuance`);
      }

      for (const userId of this.exchange.accounts.userIds()) {
        const held = this.heldTickets(userId, symbol);
        const serials = this.tickets.countHeldBy(userId, symbol);
        if (held !== serials) {
          throw new Error(
            `${userId} holds ${held} of ${symbol} but ${serials} serials`
          );
        }
      }
    }
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
          this.persistence?.enqueue(this.logPosition(), { orders: [cancelled] });
        }
      }
    }
  }

  private apply(order: Order): AppliedOrder {
    const result = this.exchange.submit(order);
    const tickets: Ticket[] = [];
    const transfers: TicketTransfer[] = [];

    for (const trade of result.trades) {
      const moved = this.tickets.transfer(
        trade.symbol,
        trade.sellUserId,
        trade.buyUserId,
        trade.quantity
      );
      for (const ticket of moved) {
        tickets.push({ ...ticket });
        transfers.push({
          ticketId: ticket.id,
          rotation: ticket.rotation,
          symbol: ticket.symbol,
          fromUserId: trade.sellUserId,
          toUserId: trade.buyUserId,
          tradeId: trade.id,
        });
      }
    }

    this.recordOrder(result.order);
    this.recordTrades(result.trades);
    return { result, tickets, transfers };
  }

  private persist(logSeq: number, applied: AppliedOrder): void {
    if (!this.persistence) {
      return;
    }

    const { result } = applied;
    const touched = new Map<string, Order>([[result.order.id, result.order]]);
    for (const trade of result.trades) {
      for (const orderId of [trade.buyOrderId, trade.sellOrderId]) {
        const order = this.orders.get(orderId);
        if (order) {
          touched.set(orderId, order);
        }
      }
    }

    this.persistence.enqueue(logSeq, {
      trades: result.trades,
      orders: [...touched.values()],
      tickets: applied.tickets,
      transfers: applied.transfers,
    });
  }

  private persistIssued(logSeq: number, issued: Ticket[]): void {
    if (!this.persistence || issued.length === 0) {
      return;
    }

    this.persistence.enqueue(logSeq, {
      tickets: issued,
      transfers: issued.map((ticket) => ({
        ticketId: ticket.id,
        rotation: ticket.rotation,
        symbol: ticket.symbol,
        fromUserId: null,
        toUserId: ticket.holderId,
        tradeId: null,
      })),
    });
  }

  private recover(entries: LogEntry[]): void {
    let highestCounter = 0;
    let highestEvent = 0;

    for (const entry of entries) {
      const command: Command = entry.command;
      const shouldPersist = entry.seq > this.lastPersistedLogSeq;

      if (command.kind === "createEvent") {
        this.events.create(command.event);
        this.ensureAccount(command.event.organizerId);
        const eventMatch = /^evt_(\d+)$/.exec(command.event.id);
        if (eventMatch) {
          highestEvent = Math.max(highestEvent, Number(eventMatch[1]));
        }
        if (shouldPersist && this.persistence) {
          this.persistence.enqueue(entry.seq, { events: [command.event] });
          this.requeuedCount += 1;
        }
        continue;
      }

      if (command.kind === "issueTickets") {
        const symbol = symbolFor(command.eventId, command.tierId);
        this.ensureAccount(command.toUserId);
        this.exchange.accounts.credit(command.toUserId, symbol, command.count);
        const issued = this.tickets.issue(symbol, command.count, command.toUserId);
        this.events.recordIssued(symbol, command.count);
        if (shouldPersist && this.persistence) {
          this.persistIssued(entry.seq, issued);
          this.requeuedCount += 1;
        }
        continue;
      }

      if (command.kind === "closeSales" || command.kind === "cancelEvent") {
        const status = command.kind === "closeSales" ? "closed" : "cancelled";
        const event = this.events.setStatus(command.eventId, status);
        if (event && shouldPersist && this.persistence) {
          this.persistence.enqueue(entry.seq, { events: [event] });
          this.requeuedCount += 1;
        }
        continue;
      }

      if (command.kind === "cancel") {
        const cancelled = this.exchange.cancel(command.symbol, command.orderId);
        if (cancelled && shouldPersist && this.persistence) {
          this.persistence.enqueue(entry.seq, { orders: [cancelled] });
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
        const applied = this.apply(order);
        if (shouldPersist && this.persistence) {
          this.persist(entry.seq, applied);
          this.requeuedCount += 1;
        }
      } catch {
        continue;
      }
    }

    this.orderCounter = highestCounter;
    this.eventCounter = highestEvent;
    this.recoveredCount = entries.length;
  }
}
