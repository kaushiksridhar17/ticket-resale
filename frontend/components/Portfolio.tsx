"use client";

import { useState } from "react";
import { ApiError, cancelOrder } from "@/lib/api";
import { centsToDollars, formatQuantity } from "@/lib/format";
import type { AccountSummary } from "@/lib/types";

interface Props {
  account: AccountSummary | null;
  onChanged: () => void;
}

export function Portfolio({ account, onChanged }: Props) {
  const [error, setError] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState<string | null>(null);

  async function cancel(orderId: string) {
    setCancelling(orderId);
    setError(null);
    try {
      await cancelOrder(orderId);
      onChanged();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Cancel failed");
    } finally {
      setCancelling(null);
    }
  }

  if (account === null) {
    return (
      <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-4">
        <h2 className="mb-4 text-xs uppercase tracking-widest text-slate-500">
          Portfolio
        </h2>
        <p className="text-sm text-slate-600">Loading</p>
      </div>
    );
  }

  const openOrders = account.orders.filter(
    (order) =>
      order.type === "limit" &&
      (order.status === "open" || order.status === "partially_filled")
  );

  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-4">
      <h2 className="mb-4 text-xs uppercase tracking-widest text-slate-500">
        Portfolio
      </h2>

      <div className="mb-4 space-y-1 font-mono text-sm">
        <div className="flex justify-between">
          <span className="text-slate-500">Cash</span>
          <span>{centsToDollars(account.cash.total)}</span>
        </div>
        <div className="flex justify-between text-xs">
          <span className="text-slate-600">Locked</span>
          <span className="text-slate-500">
            {centsToDollars(account.cash.locked)}
          </span>
        </div>
      </div>

      <div className="mb-4 space-y-1">
        <p className="text-[11px] uppercase text-slate-600">Positions</p>
        {account.positions.map((position) => (
          <div
            key={position.symbol}
            className="flex justify-between font-mono text-sm"
          >
            <span className="text-slate-400">{position.symbol}</span>
            <span>
              {formatQuantity(position.total)}
              {position.locked > 0 && (
                <span className="text-slate-600">
                  {" "}
                  ({formatQuantity(position.locked)} locked)
                </span>
              )}
            </span>
          </div>
        ))}
      </div>

      <div className="space-y-1">
        <p className="text-[11px] uppercase text-slate-600">
          Open orders ({openOrders.length})
        </p>
        {openOrders.length === 0 ? (
          <p className="text-xs text-slate-600">None</p>
        ) : (
          <div className="max-h-48 space-y-1 overflow-y-auto">
            {openOrders.map((order) => (
              <div
                key={order.id}
                className="flex items-center justify-between gap-2 font-mono text-xs"
              >
                <span
                  className={
                    order.side === "buy" ? "text-emerald-400" : "text-rose-400"
                  }
                >
                  {order.side === "buy" ? "B" : "S"} {order.symbol}
                </span>
                <span className="text-slate-400">
                  {formatQuantity(order.remainingQuantity)} @{" "}
                  {order.priceInCents !== null
                    ? centsToDollars(order.priceInCents)
                    : "mkt"}
                </span>
                <button
                  onClick={() => cancel(order.id)}
                  disabled={cancelling === order.id}
                  className="rounded bg-slate-800 px-2 py-0.5 text-slate-400 hover:bg-slate-700 disabled:opacity-40"
                >
                  {cancelling === order.id ? "..." : "cancel"}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {error && <p className="mt-2 text-xs text-rose-400">{error}</p>}
    </div>
  );
}