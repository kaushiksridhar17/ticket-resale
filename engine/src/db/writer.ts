import type { Order, Trade } from "../types.js";

export interface PersistenceBatch {
  trades: Trade[];
  orders: Order[];
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

  enqueue(logSeq: number, trades: Trade[], orders: Order[]): void {
    if (trades.length === 0 && orders.length === 0) {
      return;
    }
    this.queue.push({
      logSeq,
      trades: trades.map((trade) => ({ ...trade })),
      orders: orders.map((order) => ({ ...order })),
    });
    this.pendingItems += trades.length + orders.length;

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
    const size = this.countItems(groups);

    try {
      await this.sink.write(batch);
      this.written += batch.trades.length + batch.orders.length;
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
      const size = group.trades.length + group.orders.length;
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

    for (const group of groups) {
      trades.push(...group.trades);
      for (const order of group.orders) {
        orders.set(order.id, order);
      }
    }

    return {
      trades,
      orders: [...orders.values()],
      lastLogSeq: groups[groups.length - 1]?.logSeq ?? 0,
    };
  }

  private countItems(groups: Group[]): number {
    return groups.reduce(
      (sum, group) => sum + group.trades.length + group.orders.length,
      0
    );
  }
}