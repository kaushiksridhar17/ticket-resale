import type { EventDefinition } from "../events/types.js";
import type { Ticket, TicketTransfer } from "../tickets/types.js";
import type { Order, Trade } from "../types.js";

export interface PersistenceChanges {
  trades?: Trade[];
  orders?: Order[];
  events?: EventDefinition[];
  tickets?: Ticket[];
  transfers?: TicketTransfer[];
}

export interface PersistenceBatch {
  trades: Trade[];
  orders: Order[];
  events: EventDefinition[];
  tickets: Ticket[];
  transfers: TicketTransfer[];
  lastLogSeq: number;
}

export interface PersistenceSink {
  write(batch: PersistenceBatch): Promise<void>;
}

export interface WriterOptions {
  flushIntervalMs?: number;
  maxBatchSize?: number;
  onError?: (error: unknown) => void;
}

interface Group {
  logSeq: number;
  trades: Trade[];
  orders: Order[];
  events: EventDefinition[];
  tickets: Ticket[];
  transfers: TicketTransfer[];
}

export class PersistenceWriter {
  private queue: Group[] = [];
  private pendingItems = 0;
  private timer: NodeJS.Timeout | null = null;
  private inFlight: Promise<void> | null = null;
  private written = 0;
  private failures = 0;
  private readonly flushIntervalMs: number;
  private readonly maxBatchSize: number;
  private readonly onError: (error: unknown) => void;

  constructor(
    private readonly sink: PersistenceSink,
    options: WriterOptions = {}
  ) {
    this.flushIntervalMs = options.flushIntervalMs ?? 250;
    this.maxBatchSize = options.maxBatchSize ?? 500;
    this.onError =
      options.onError ??
      ((error) => {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`Persistence write failed: ${message}`);
      });
  }

  start(): void {
    if (this.timer) {
      return;
    }
    this.timer = setInterval(() => void this.flush(), this.flushIntervalMs);
    this.timer.unref();
  }

  enqueue(logSeq: number, changes: PersistenceChanges): void {
    const group: Group = {
      logSeq,
      trades: (changes.trades ?? []).map((trade) => ({ ...trade })),
      orders: (changes.orders ?? []).map((order) => ({ ...order })),
      events: (changes.events ?? []).map((event) => structuredClone(event)),
      tickets: (changes.tickets ?? []).map((ticket) => ({ ...ticket })),
      transfers: (changes.transfers ?? []).map((transfer) => ({ ...transfer })),
    };

    const size = groupSize(group);
    if (size === 0) {
      return;
    }

    this.queue.push(group);
    this.pendingItems += size;

    if (!this.inFlight && this.pendingItems >= this.maxBatchSize) {
      void this.flush();
    }
  }

  pending(): number {
    return this.pendingItems;
  }

  stats() {
    return {
      pending: this.pendingItems,
      written: this.written,
      failures: this.failures,
    };
  }

  flush(): Promise<void> {
    if (this.inFlight) {
      return this.inFlight;
    }
    if (this.queue.length === 0) {
      return Promise.resolve();
    }

    this.inFlight = this.writeNext().then((succeeded) => {
      this.inFlight = null;
      if (succeeded && this.pendingItems >= this.maxBatchSize) {
        void this.flush();
      }
    });
    return this.inFlight;
  }

  async drain(maxFailures = 3): Promise<void> {
    let failed = 0;
    while (this.inFlight || this.queue.length > 0) {
      const before = this.failures;
      await (this.inFlight ?? this.flush());
      if (this.failures > before) {
        failed += 1;
        if (failed >= maxFailures) {
          return;
        }
      }
    }
  }

  async close(): Promise<void> {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    await this.drain();
  }

  private async writeNext(): Promise<boolean> {
    const groups = this.takeGroups();
    const batch = this.buildBatch(groups);
    const size = groups.reduce((sum, group) => sum + groupSize(group), 0);

    try {
      await this.sink.write(batch);
      this.written +=
        batch.trades.length +
        batch.orders.length +
        batch.events.length +
        batch.tickets.length +
        batch.transfers.length;
      return true;
    } catch (error) {
      this.failures += 1;
      this.queue.unshift(...groups);
      this.pendingItems += size;
      this.onError(error);
      return false;
    }
  }

  private takeGroups(): Group[] {
    let count = 0;
    let take = 0;
    while (take < this.queue.length && (take === 0 || count < this.maxBatchSize)) {
      const group = this.queue[take]!;
      const size = groupSize(group);
      if (take > 0 && count + size > this.maxBatchSize) {
        break;
      }
      count += size;
      take += 1;
    }
    const groups = this.queue.splice(0, take);
    this.pendingItems -= count;
    return groups;
  }

  private buildBatch(groups: Group[]): PersistenceBatch {
    const trades: Trade[] = [];
    const orders = new Map<string, Order>();
    const events = new Map<string, EventDefinition>();
    const tickets = new Map<string, Ticket>();
    const transfers = new Map<string, TicketTransfer>();

    for (const group of groups) {
      trades.push(...group.trades);
      for (const order of group.orders) {
        orders.set(order.id, order);
      }
      for (const event of group.events) {
        events.set(event.id, event);
      }
      for (const ticket of group.tickets) {
        tickets.set(ticket.id, ticket);
      }
      for (const transfer of group.transfers) {
        transfers.set(`${transfer.ticketId}:${transfer.rotation}`, transfer);
      }
    }

    return {
      trades,
      orders: [...orders.values()],
      events: [...events.values()],
      tickets: [...tickets.values()],
      transfers: [...transfers.values()],
      lastLogSeq: groups[groups.length - 1]?.logSeq ?? 0,
    };
  }
}

function groupSize(group: Group): number {
  return (
    group.trades.length +
    group.orders.length +
    group.events.length +
    group.tickets.length +
    group.transfers.length
  );
}
