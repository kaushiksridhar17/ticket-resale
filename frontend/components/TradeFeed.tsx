"use client";

import { centsToDollars, formatQuantity, formatTime } from "@/lib/format";
import type { Trade } from "@/lib/types";

interface Props {
  trades: Trade[];
  userId: string;
}

export function TradeFeed({ trades, userId }: Props) {
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-4">
      <h2 className="mb-4 text-xs uppercase tracking-widest text-slate-500">
        Recent trades
      </h2>

      {trades.length === 0 ? (
        <p className="text-sm text-slate-600">No trades yet</p>
      ) : (
        <>
          <div className="mb-1 flex justify-between font-mono text-[11px] uppercase text-slate-600">
            <span>Price</span>
            <span>Size</span>
            <span>Time</span>
          </div>
          <div className="max-h-80 space-y-px overflow-y-auto">
            {trades.map((trade) => {
              const mine =
                trade.buyUserId === userId || trade.sellUserId === userId;
              return (
                <div
                  key={trade.id}
                  className={`flex justify-between px-2 py-1 font-mono text-sm ${
                    mine ? "bg-sky-500/10" : ""
                  }`}
                >
                  <span
                    className={
                      trade.takerSide === "buy"
                        ? "text-emerald-400"
                        : "text-rose-400"
                    }
                  >
                    {centsToDollars(trade.priceInCents)}
                  </span>
                  <span className="text-slate-300">
                    {formatQuantity(trade.quantity)}
                  </span>
                  <span className="text-slate-600">
                    {formatTime(trade.executedAt)}
                  </span>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}