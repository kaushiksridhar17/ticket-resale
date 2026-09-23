import { MatchingEngine } from "../src/matchingEngine.js";
import type { Order, OrderType, Side } from "../src/types.js";

const SYMBOL = "evt_demo:GA";

function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function buildOrders(count: number, seed: number): Order[] {
  const random = mulberry32(seed);
  const users = ["u1", "u2", "u3", "u4", "u5", "u6", "u7", "u8"];
  const orders: Order[] = [];

  for (let i = 1; i <= count; i += 1) {
    const side: Side = random() < 0.5 ? "buy" : "sell";
    const type: OrderType = random() < 0.15 ? "market" : "limit";
    const quantity = 1 + Math.floor(random() * 50);
    const priceInCents =
      type === "market" ? null : 9900 + Math.floor(random() * 201);

    orders.push({
      id: `ord_${i}`,
      userId: users[Math.floor(random() * users.length)]!,
      symbol: SYMBOL,
      side,
      type,
      priceInCents,
      quantity,
      remainingQuantity: quantity,
      status: "open",
      sequence: 0,
      createdAt: 1_700_000_000_000 + i,
    });
  }

  return orders;
}

function percentile(sorted: number[], p: number): number {
  const index = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[index]!;
}

function run(count: number, seed: number) {
  const orders = buildOrders(count, seed);
  const engine = new MatchingEngine();
  const latencies = new Float64Array(count);
  let trades = 0;

  const start = process.hrtime.bigint();

  for (let i = 0; i < count; i += 1) {
    const orderStart = process.hrtime.bigint();
    const result = engine.submit(orders[i]!);
    const orderEnd = process.hrtime.bigint();

    latencies[i] = Number(orderEnd - orderStart) / 1000;
    trades += result.trades.length;
  }

  const end = process.hrtime.bigint();
  const elapsedSeconds = Number(end - start) / 1_000_000_000;
  const sorted = Array.from(latencies).sort((a, b) => a - b);

  return {
    orders: count,
    trades,
    elapsedSeconds,
    ordersPerSecond: Math.round(count / elapsedSeconds),
    meanMicros: sorted.reduce((a, b) => a + b, 0) / sorted.length,
    p50Micros: percentile(sorted, 50),
    p95Micros: percentile(sorted, 95),
    p99Micros: percentile(sorted, 99),
    maxMicros: sorted[sorted.length - 1]!,
  };
}

const COUNT = Number(process.env.ORDERS ?? 200_000);

console.log("warming up");
run(20_000, 1);

console.log(`running ${COUNT.toLocaleString()} orders\n`);
const result = run(COUNT, 42);

console.log(`orders submitted    ${result.orders.toLocaleString()}`);
console.log(`trades executed     ${result.trades.toLocaleString()}`);
console.log(`elapsed             ${result.elapsedSeconds.toFixed(2)}s`);
console.log(`throughput          ${result.ordersPerSecond.toLocaleString()} orders/sec`);
console.log(`\nper-order latency`);
console.log(`  mean              ${result.meanMicros.toFixed(2)} us`);
console.log(`  p50               ${result.p50Micros.toFixed(2)} us`);
console.log(`  p95               ${result.p95Micros.toFixed(2)} us`);
console.log(`  p99               ${result.p99Micros.toFixed(2)} us`);
console.log(`  max               ${result.maxMicros.toFixed(2)} us`);