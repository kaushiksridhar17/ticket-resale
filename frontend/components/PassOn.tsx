"use client";

import { useState } from "react";
import { ApiError, cancelOrder, placeOrder } from "@/lib/api";
import type { Order } from "@/lib/types";

export function Quantity({
  value,
  max,
  onChange,
}: {
  value: number;
  max: number;
  onChange: (next: number) => void;
}) {
  return (
    <label className="eyebrow text-muted">
      How many
      <select
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className="mt-1.5 block w-16 border border-rule bg-card px-2 py-2.5 font-sans text-sm text-ink outline-none focus:border-ink"
      >
        {Array.from({ length: max }, (_, index) => index + 1).map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </label>
  );
}

export function PassOnPanel({
  symbol,
  faceValueInCents,
  sellable,
  heading = "Can't go?",
  onChanged,
}: {
  symbol: string;
  faceValueInCents: number;
  sellable: number;
  heading?: string;
  onChanged: () => void;
}) {
  const [quantity, setQuantity] = useState(1);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function passOn() {
    setPending(true);
    setError(null);
    setMessage(null);

    try {
      const result = await placeOrder({
        symbol,
        side: "sell",
        type: "limit",
        priceInCents: faceValueInCents,
        quantity,
      });

      const gone = result.trades.reduce((sum, trade) => sum + trade.quantity, 0);
      setMessage(
        gone === quantity
          ? "Gone."
          : gone > 0
            ? `${gone} gone, ${quantity - gone} waiting.`
            : "In the queue."
      );

      onChanged();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Something went wrong");
    } finally {
      setPending(false);
    }
  }

  return (
    <section>
      <h3 className="eyebrow text-muted">{heading}</h3>

      <div className="mt-3 flex items-end gap-4">
        <Quantity
          value={Math.min(quantity, sellable)}
          max={sellable}
          onChange={setQuantity}
        />
        <button
          onClick={() => void passOn()}
          disabled={pending}
          className="eyebrow flex-1 border border-ink py-3.5 text-ink transition hover:bg-ink hover:text-paper disabled:opacity-40"
        >
          {pending ? "Working" : "Pass it on"}
        </button>
      </div>

      {message && <p className="mt-3 text-sm">{message}</p>}
      {error && <p className="mt-3 text-sm text-accent">{error}</p>}
    </section>
  );
}

export function RestingOrders({
  orders,
  onChanged,
}: {
  orders: Order[];
  onChanged: () => void;
}) {
  if (orders.length === 0) {
    return null;
  }

  return (
    <section>
      <h3 className="eyebrow text-muted">Pending</h3>
      <ul className="mt-3 border-t border-rule">
        {orders.map((order) => (
          <li
            key={order.id}
            className="flex items-baseline justify-between gap-4 border-b border-rule py-3 text-sm"
          >
            <span>
              {order.side === "buy" ? "Waiting for" : "Passing on"}{" "}
              {order.remainingQuantity}
            </span>
            <button
              onClick={async () => {
                await cancelOrder(order.id).catch(() => undefined);
                onChanged();
              }}
              className="eyebrow text-muted hover:text-accent"
            >
              {order.side === "buy" ? "Leave queue" : "Withdraw"}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function restingFor(orders: Order[], symbol: string): Order[] {
  return orders.filter(
    (order) =>
      order.symbol === symbol &&
      (order.status === "open" || order.status === "partially_filled")
  );
}
