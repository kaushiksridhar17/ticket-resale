"use client";

import { useState } from "react";
import { ApiError, placeOrder } from "@/lib/api";
import { centsToDollars, dollarsToCents } from "@/lib/format";
import type { AccountSummary, Side } from "@/lib/types";

interface Props {
  symbol: string;
  account: AccountSummary | null;
  selectedPrice: number | null;
  bestBid: number | null;
  bestAsk: number | null;
  onPlaced: () => void;
}

export function OrderForm({
  symbol,
  account,
  selectedPrice,
  bestBid,
  bestAsk,
  onPlaced,
}: Props) {
  const [side, setSide] = useState<Side>("buy");
  const [type, setType] = useState<"limit" | "market">("limit");
  const [price, setPrice] = useState("");
  const [quantity, setQuantity] = useState("");
  const [message, setMessage] = useState<{
    text: string;
    tone: "error" | "success";
  } | null>(null);
  const [pending, setPending] = useState(false);
  const [appliedPrice, setAppliedPrice] = useState<number | null>(null);
  const [formSymbol, setFormSymbol] = useState(symbol);

  if (formSymbol !== symbol) {
    setFormSymbol(symbol);
    setMessage(null);
  }

  if (selectedPrice !== null && selectedPrice !== appliedPrice) {
    setAppliedPrice(selectedPrice);
    setPrice(centsToDollars(selectedPrice).replace(/,/g, ""));
    setType("limit");
  }

  const position = account?.positions.find((entry) => entry.symbol === symbol);
  const availableCash = account
    ? account.cash.total - account.cash.locked
    : 0;
  const availableShares = position ? position.total - position.locked : 0;

  const priceInCents = type === "limit" ? dollarsToCents(price) : null;
  const quantityValue = Number(quantity);
  const quantityValid =
    Number.isInteger(quantityValue) && quantityValue > 0;

  const estimatedCost =
    type === "limit" && priceInCents !== null && quantityValid
      ? priceInCents * quantityValue
      : type === "market" && bestAsk !== null && quantityValid
        ? bestAsk * quantityValue
        : null;

  const canSubmit =
    quantityValid &&
    !pending &&
    (type === "market" || priceInCents !== null) &&
    (type !== "market" || side === "sell" || bestAsk !== null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!canSubmit) {
      return;
    }

    setPending(true);
    setMessage(null);

    try {
      const result = await placeOrder({
        symbol,
        side,
        type,
        ...(type === "limit" ? { priceInCents: priceInCents! } : {}),
        ...(type === "market" && side === "buy" && bestAsk !== null
          ? {
              maxNotionalInCents: Math.min(
                availableCash,
                Math.round(bestAsk * quantityValue * 2)
              ),
            }
          : {}),
        quantity: quantityValue,
      });

      const filled = result.trades.reduce((sum, trade) => sum + trade.quantity, 0);
      setMessage({
        text:
          filled === 0
            ? `Order resting: ${result.order.quantity} @ ${centsToDollars(
                result.order.priceInCents ?? 0
              )}`
            : `Filled ${filled} of ${result.order.quantity}`,
        tone: "success",
      });
      setQuantity("");
      onPlaced();
    } catch (caught) {
      const text =
        caught instanceof ApiError
          ? caught.message
          : "Could not reach the exchange";
      setMessage({ text, tone: "error" });
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-4">
      <h2 className="mb-4 text-xs uppercase tracking-widest text-slate-500">
        Place order
      </h2>

      <div className="mb-4 grid grid-cols-2 gap-1 rounded bg-slate-900 p-1">
        <button
          type="button"
          onClick={() => setSide("buy")}
          className={`rounded py-1.5 text-sm font-medium transition ${
            side === "buy"
              ? "bg-emerald-600 text-white"
              : "text-slate-400 hover:text-slate-200"
          }`}
        >
          Buy
        </button>
        <button
          type="button"
          onClick={() => setSide("sell")}
          className={`rounded py-1.5 text-sm font-medium transition ${
            side === "sell"
              ? "bg-rose-600 text-white"
              : "text-slate-400 hover:text-slate-200"
          }`}
        >
          Sell
        </button>
      </div>

      <div className="mb-4 flex gap-4 text-xs">
        <button
          type="button"
          onClick={() => setType("limit")}
          className={type === "limit" ? "text-slate-100" : "text-slate-600"}
        >
          Limit
        </button>
        <button
          type="button"
          onClick={() => setType("market")}
          className={type === "market" ? "text-slate-100" : "text-slate-600"}
        >
          Market
        </button>
      </div>

      <form onSubmit={submit} className="space-y-3">
        {type === "limit" && (
          <label className="block">
            <span className="mb-1 block text-[11px] uppercase text-slate-600">
              Price
            </span>
            <input
              value={price}
              onChange={(event) => setPrice(event.target.value)}
              inputMode="decimal"
              placeholder="0.00"
              className="w-full rounded border border-slate-800 bg-slate-950 px-3 py-2 font-mono text-sm outline-none focus:border-slate-600"
            />
          </label>
        )}

        <label className="block">
          <span className="mb-1 block text-[11px] uppercase text-slate-600">
            Quantity
          </span>
          <input
            value={quantity}
            onChange={(event) => setQuantity(event.target.value)}
            inputMode="numeric"
            placeholder="0"
            className="w-full rounded border border-slate-800 bg-slate-950 px-3 py-2 font-mono text-sm outline-none focus:border-slate-600"
          />
        </label>

        <div className="space-y-1 font-mono text-[11px] text-slate-600">
          <div className="flex justify-between">
            <span>Available</span>
            <span>
              {side === "buy"
                ? centsToDollars(availableCash)
                : `${availableShares} ${symbol}`}
            </span>
          </div>
          {estimatedCost !== null && (
            <div className="flex justify-between">
              <span>Estimated {side === "buy" ? "cost" : "proceeds"}</span>
              <span>{centsToDollars(estimatedCost)}</span>
            </div>
          )}
          {type === "market" && (
            <div className="flex justify-between">
              <span>Reference</span>
              <span>
                {side === "buy"
                  ? bestAsk !== null
                    ? centsToDollars(bestAsk)
                    : "no asks"
                  : bestBid !== null
                    ? centsToDollars(bestBid)
                    : "no bids"}
              </span>
            </div>
          )}
        </div>

        <button
          type="submit"
          disabled={!canSubmit}
          className={`w-full rounded py-2 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-40 ${
            side === "buy"
              ? "bg-emerald-600 hover:bg-emerald-500"
              : "bg-rose-600 hover:bg-rose-500"
          }`}
        >
          {pending ? "Submitting" : `${side === "buy" ? "Buy" : "Sell"} ${symbol}`}
        </button>

        {message && (
          <p
            className={`text-xs ${
              message.tone === "error" ? "text-rose-400" : "text-emerald-400"
            }`}
          >
            {message.text}
          </p>
        )}
      </form>
    </div>
  );
}