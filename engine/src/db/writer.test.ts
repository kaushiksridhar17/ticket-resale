import { describe, expect, it } from "vitest";
import {
  PersistenceWriter,
  type PersistenceBatch,
  type PersistenceSink,
} from "./writer.js";
import type { Order, Trade } from "../types.js";

class FakeSink implements PersistenceSink {
  batches: PersistenceBatch[] = [];
  failuresRemaining = 0;
  delayMs = 0;
  active = 0;
  maxActive = 0;

  async write(batch: PersistenceBatch): Promise<void> {
    this.active += 1;
    this.maxActive = Math.max(this.maxActive, this.active);
    try {
      if (this.delayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, this.delayMs));
      }
      if (this.failuresRemaining > 0) {
        this.failuresRemaining -= 1;
        throw new Error("database unavailable");
      }
      this.batches.push(structuredClone(batch));
    } finally {
      this.active -= 1;
    }
  }

  tradeIds(): string[] {
    return this.batches.flatMap((batch) => batch.trades.map((trade) => trade.id));
  }
}

function trade(n: number): Trade {
  return {
    id: `trd_${n}`,
    symbol: "evt_demo:GA",
    priceInCents: 5000,
    quantity: 10,
    buyOrderId: `ord_b${n}`,
    sellOrderId: `ord_s${n}`,
    buyUserId: "alice",
    sellUserId: "bob",
    takerSide: "buy",
    sequence: n,
    executedAt: 1_700_000_000_000 + n,
  };
}

function order(
  id: string,
  remainingQuantity: number,
  status: Order["status"] = "open"
): Order {
  return {
    id,
    userId: "alice",
    symbol: "evt_demo:GA",
    side: "buy",
    type: "limit",
    priceInCents: 5000,
    quantity: 10,
    remainingQuantity,
    status,
    sequence: 1,
    createdAt: 1_700_000_000_000,
  };
}

const quiet = { onError: () => undefined };

describe("PersistenceWriter", () => {
  it("writes nothing when the queue is empty", async () => {
    const sink = new FakeSink();
    const writer = new PersistenceWriter(sink, quiet);

    await writer.flush();

    expect(sink.batches).toHaveLength(0);
  });

  it("writes queued trades and orders in one batch", async () => {
    const sink = new FakeSink();
    const writer = new PersistenceWriter(sink, quiet);

    writer.enqueue(1, { trades: [trade(1), trade(2)], orders: [order("ord_1", 10)] });
    await writer.flush();

    expect(sink.batches).toHaveLength(1);
    expect(sink.tradeIds()).toEqual(["trd_1", "trd_2"]);
    expect(sink.batches[0]?.orders).toHaveLength(1);
    expect(writer.pending()).toBe(0);
  });

  it("keeps only the latest snapshot of an order within a batch", async () => {
    const sink = new FakeSink();
    const writer = new PersistenceWriter(sink, quiet);

    writer.enqueue(1, { orders: [order("ord_1", 10, "open")] });
    writer.enqueue(2, { orders: [order("ord_1", 4, "partially_filled")] });
    await writer.flush();

    const orders = sink.batches[0]?.orders ?? [];
    expect(orders).toHaveLength(1);
    expect(orders[0]?.remainingQuantity).toBe(4);
    expect(orders[0]?.status).toBe("partially_filled");
  });

  it("copies snapshots so later changes to an order do not leak in", async () => {
    const sink = new FakeSink();
    const writer = new PersistenceWriter(sink, quiet);
    const live = order("ord_1", 10);

    writer.enqueue(1, { orders: [live] });
    live.remainingQuantity = 0;
    live.status = "filled";
    await writer.flush();

    expect(sink.batches[0]?.orders[0]?.remainingQuantity).toBe(10);
    expect(sink.batches[0]?.orders[0]?.status).toBe("open");
  });

  it("splits a large backlog into bounded batches", async () => {
    const sink = new FakeSink();
    const writer = new PersistenceWriter(sink, { ...quiet, maxBatchSize: 100 });

    for (let n = 1; n <= 1000; n += 1) {
      writer.enqueue(n, { trades: [trade(n)] });
    }
    await writer.drain();

    expect(sink.tradeIds()).toHaveLength(1000);
    for (const batch of sink.batches) {
      expect(batch.trades.length + batch.orders.length).toBeLessThanOrEqual(100);
    }
  });

  it("records the log position of the last command in each batch", async () => {
    const sink = new FakeSink();
    const writer = new PersistenceWriter(sink, { ...quiet, maxBatchSize: 2 });

    writer.enqueue(1, { trades: [trade(1)] });
    writer.enqueue(2, { trades: [trade(2)] });
    writer.enqueue(3, { trades: [trade(3)] });
    await writer.drain();

    expect(sink.batches.map((batch) => batch.lastLogSeq)).toEqual([2, 3]);
  });

  it("never splits one command's results across batches", async () => {
    const sink = new FakeSink();
    const writer = new PersistenceWriter(sink, { ...quiet, maxBatchSize: 3 });

    writer.enqueue(1, { trades: [trade(1), trade(2)] });
    writer.enqueue(2, { trades: [trade(3), trade(4)] });
    await writer.drain();

    expect(sink.batches.map((batch) => batch.trades.length)).toEqual([2, 2]);
  });

  it("retries a failed batch without losing or reordering data", async () => {
    const sink = new FakeSink();
    let errors = 0;
    const writer = new PersistenceWriter(sink, { onError: () => (errors += 1) });
    sink.failuresRemaining = 1;

    writer.enqueue(1, { trades: [trade(1)] });
    writer.enqueue(2, { trades: [trade(2)] });

    await writer.flush();
    expect(sink.batches).toHaveLength(0);
    expect(writer.pending()).toBe(2);
    expect(errors).toBe(1);

    await writer.flush();
    expect(sink.tradeIds()).toEqual(["trd_1", "trd_2"]);
    expect(sink.batches[0]?.lastLogSeq).toBe(2);
    expect(writer.stats().failures).toBe(1);
  });

  it("never has more than one write in flight", async () => {
    const sink = new FakeSink();
    sink.delayMs = 10;
    const writer = new PersistenceWriter(sink, { ...quiet, maxBatchSize: 1 });

    for (let n = 1; n <= 5; n += 1) {
      writer.enqueue(n, { trades: [trade(n)] });
    }
    await writer.drain();

    expect(sink.maxActive).toBe(1);
    expect(sink.tradeIds()).toEqual(["trd_1", "trd_2", "trd_3", "trd_4", "trd_5"]);
  });

  it("flushes on its own timer", async () => {
    const sink = new FakeSink();
    const writer = new PersistenceWriter(sink, { ...quiet, flushIntervalMs: 20 });
    writer.start();

    writer.enqueue(1, { trades: [trade(1)] });
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(sink.tradeIds()).toEqual(["trd_1"]);
    await writer.close();
  });

  it("drains everything on close", async () => {
    const sink = new FakeSink();
    const writer = new PersistenceWriter(sink, { ...quiet, maxBatchSize: 10 });

    for (let n = 1; n <= 35; n += 1) {
      writer.enqueue(n, { trades: [trade(n)] });
    }
    await writer.close();

    expect(writer.pending()).toBe(0);
    expect(sink.tradeIds()).toHaveLength(35);
  });

  it("gives up on close after repeated failures instead of hanging", async () => {
    const sink = new FakeSink();
    sink.failuresRemaining = 100;
    const writer = new PersistenceWriter(sink, quiet);

    writer.enqueue(1, { trades: [trade(1)] });
    await writer.close();

    expect(writer.pending()).toBe(1);
    expect(sink.batches).toHaveLength(0);
  });
});