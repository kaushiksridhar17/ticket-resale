"use client";

import { centsToDollars, formatQuantity } from "@/lib/format";
import type { BookLevel, OrderBookSnapshot } from "@/lib/types";

interface Props {
  book: OrderBookSnapshot | null;
  onPriceClick: (priceInCents: number) => void;
}

interface Row {
  level: BookLevel;
  cumulative: number;
}

function buildRows(levels: BookLevel[]): Row[] {
  let running = 0;
  return levels.map((level) => {
    running += level.totalQuantity;
    return { level, cumulative: running };
  });
}

export function OrderBook({ book, onPriceClick }: Props) {
  if (book === null) {
    return (
      <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-4">
        <h2 className="mb-4 text-xs uppercase tracking-widest text-slate-500">
          Order book
        </h2>
        <p className="text-sm text-slate-600">Waiting for market data</p>
      </div>
    );
  }

  const bidRows = buildRows(book.bids);
  const askRows = buildRows(book.asks);
  const maxDepth = Math.max(
    bidRows[bidRows.length - 1]?.cumulative ?? 0,
    askRows[askRows.length - 1]?.cumulative ?? 0,
    1
  );

  const bestBid = book.bids[0]?.priceInCents ?? null;
  const bestAsk = book.asks[0]?.priceInCents ?? null;
  const spread =
    bestBid !== null && bestAsk !== null ? bestAsk - bestBid : null;

  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-4">
      <div className="mb-4 flex items-baseline justify-between">
        <h2 className="text-xs uppercase tracking-widest text-slate-500">
          Order book
        </h2>
        {spread !== null && (
          <span className="font-mono text-xs text-slate-500">
            spread {centsToDollars(spread)}
          </span>
        )}
      </div>

      <div className="mb-1 flex justify-between font-mono text-[11px] uppercase text-slate-600">
        <span>Price</span>
        <span>Size</span>
      </div>

      <div className="space-y-px">
        {[...askRows].reverse().map(({ level, cumulative }) => (
          <button
            key={level.priceInCents}
            onClick={() => onPriceClick(level.priceInCents)}
            className="relative flex w-full justify-between px-2 py-1 font-mono text-sm hover:bg-slate-800/60"
          >
            <span
              className="absolute inset-y-0 right-0 bg-rose-500/10"
              style={{ width: `${(cumulative / maxDepth) * 100}%` }}
            />
            <span className="relative text-rose-400">
              {centsToDollars(level.priceInCents)}
            </span>
            <span className="relative text-slate-300">
              {formatQuantity(level.totalQuantity)}
            </span>
          </button>
        ))}
      </div>

      <div className="my-2 border-t border-slate-800" />

      <div className="space-y-px">
        {bidRows.map(({ level, cumulative }) => (
          <button
            key={level.priceInCents}
            onClick={() => onPriceClick(level.priceInCents)}
            className="relative flex w-full justify-between px-2 py-1 font-mono text-sm hover:bg-slate-800/60"
          >
            <span
              className="absolute inset-y-0 right-0 bg-emerald-500/10"
              style={{ width: `${(cumulative / maxDepth) * 100}%` }}
            />
            <span className="relative text-emerald-400">
              {centsToDollars(level.priceInCents)}
            </span>
            <span className="relative text-slate-300">
              {formatQuantity(level.totalQuantity)}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}