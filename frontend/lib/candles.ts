import type { Trade } from "./types";

export interface Candle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

export interface ServerCandle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export const BUCKET_SECONDS = 5;

export function toLocalSeconds(utcSeconds: number): number {
  const offsetSeconds = new Date(utcSeconds * 1000).getTimezoneOffset() * 60;
  return utcSeconds - offsetSeconds;
}

function bucketFor(epochMs: number): number {
  const utcBucket =
    Math.floor(epochMs / 1000 / BUCKET_SECONDS) * BUCKET_SECONDS;
  return toLocalSeconds(utcBucket);
}

export function buildCandles(trades: Trade[]): Candle[] {
  if (trades.length === 0) {
    return [];
  }

  const ordered = [...trades].sort((a, b) => a.sequence - b.sequence);
  const byBucket = new Map<number, Candle>();

  for (const trade of ordered) {
    const time = bucketFor(trade.executedAt);
    const price = trade.priceInCents / 100;
    const existing = byBucket.get(time);

    if (!existing) {
      byBucket.set(time, {
        time,
        open: price,
        high: price,
        low: price,
        close: price,
      });
      continue;
    }

    existing.high = Math.max(existing.high, price);
    existing.low = Math.min(existing.low, price);
    existing.close = price;
  }

  return [...byBucket.values()].sort((a, b) => a.time - b.time);
}

export function fromServerCandles(candles: ServerCandle[]): Candle[] {
  return candles.map((candle) => ({
    time: toLocalSeconds(candle.time),
    open: candle.open / 100,
    high: candle.high / 100,
    low: candle.low / 100,
    close: candle.close / 100,
  }));
}

export function mergeCandles(history: Candle[], live: Candle[]): Candle[] {
  const last = history[history.length - 1];
  if (!last) {
    return live;
  }

  let tail: Candle = { ...last };
  const newer: Candle[] = [];

  for (const candle of live) {
    if (candle.time < tail.time) {
      continue;
    }
    if (candle.time === tail.time) {
      tail = {
        time: tail.time,
        open: tail.open,
        high: Math.max(tail.high, candle.high),
        low: Math.min(tail.low, candle.low),
        close: candle.close,
      };
      continue;
    }
    newer.push(candle);
  }

  return [...history.slice(0, -1), tail, ...newer];
}