"use client";

import { useState } from "react";
import Link from "next/link";
import { ApiError, cancelOrder, placeOrder } from "@/lib/api";
import { centsToDollars, dollarsToCents, formatPrice } from "@/lib/format";
import { useExchangeSocket } from "@/lib/useExchangeSocket";
import type { AccountSummary, EventSummary, Tier, User } from "@/lib/types";

interface Props {
  event: EventSummary;
  tier: Tier;
  user: User | null;
  account: AccountSummary | null;
  onChanged: () => void;
}

export function TierPanel({ event, tier, user, account, onChanged }: Props) {
  const { book } = useExchangeSocket(tier.symbol);

  const available = (book?.asks ?? []).reduce(
    (sum, level) => sum + level.totalQuantity,
    0
  );
  const cheapest = book?.asks[0]?.priceInCents ?? null;
  const waiting = (book?.bids ?? []).reduce(
    (sum, level) => sum + level.totalQuantity,
    0
  );

  const position = account?.positions.find((entry) => entry.symbol === tier.symbol);
  const held = position?.total ?? 0;
  const sellable = (position?.total ?? 0) - (position?.locked ?? 0);

  const resting = (account?.orders ?? []).filter(
    (order) =>
      order.symbol === tier.symbol &&
      (order.status === "open" || order.status === "partially_filled")
  );
  const queued = resting
    .filter((order) => order.side === "buy")
    .reduce((sum, order) => sum + order.remainingQuantity, 0);

  const canBuy = tier.perPersonLimit - held - queued;
  const open = event.resaleOpen;

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-5">
        <div className="flex items-baseline justify-between">
          <h2 className="font-medium">{tier.name}</h2>
          <span className="font-mono text-sm">
            {formatPrice(tier.faceValueInCents)}
          </span>
        </div>
        <p className="mt-3 text-sm text-slate-400">
          {!open
            ? "Resale has closed for this event."
            : available > 0
              ? `${available} available, cheapest ${formatPrice(cheapest ?? 0)}`
              : waiting > 0
                ? `None available right now. ${waiting} ${waiting === 1 ? "ticket" : "tickets"} wanted.`
                : "None available right now."}
        </p>
        <p className="mt-1 text-xs text-slate-600">
          {tier.issued} issued · limit {tier.perPersonLimit} per person
          {held > 0 ? ` · you hold ${held}` : ""}
        </p>
      </div>

      {!user ? (
        <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-5 text-sm text-slate-400">
          <Link href="/signin" className="text-slate-100 underline">
            Sign in
          </Link>{" "}
          to buy a ticket or join the queue.
        </div>
      ) : !open ? null : (
        <>
          <BuyPanel
            tier={tier}
            available={available}
            allowance={canBuy}
            onChanged={onChanged}
          />
          {sellable > 0 && (
            <SellPanel tier={tier} sellable={sellable} onChanged={onChanged} />
          )}
        </>
      )}

      {resting.length > 0 && (
        <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-5">
          <h3 className="mb-3 text-xs font-medium uppercase tracking-wide text-slate-500">
            Your open requests
          </h3>
          <ul className="space-y-2">
            {resting.map((order) => (
              <li
                key={order.id}
                className="flex items-center justify-between text-sm"
              >
                <span className="text-slate-300">
                  {order.side === "buy" ? "Waiting for" : "Selling"}{" "}
                  {order.remainingQuantity}
                  {order.side === "sell" && order.priceInCents !== null
                    ? ` at ${formatPrice(order.priceInCents)}`
                    : ""}
                </span>
                <button
                  onClick={async () => {
                    await cancelOrder(order.id).catch(() => undefined);
                    onChanged();
                  }}
                  className="text-xs text-slate-500 underline hover:text-slate-300"
                >
                  {order.side === "buy" ? "leave queue" : "stop selling"}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function BuyPanel({
  tier,
  available,
  allowance,
  onChanged,
}: {
  tier: Tier;
  available: number;
  allowance: number;
  onChanged: () => void;
}) {
  const [quantity, setQuantity] = useState(1);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (allowance <= 0) {
    return (
      <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-5 text-sm text-slate-400">
        You have reached the limit of {tier.perPersonLimit} for this event.
      </div>
    );
  }

  async function buy() {
    setPending(true);
    setError(null);
    setMessage(null);

    try {
      const result = await placeOrder({
        symbol: tier.symbol,
        side: "buy",
        type: "limit",
        priceInCents: tier.faceValueInCents,
        quantity,
      });

      const got = result.trades.reduce((sum, trade) => sum + trade.quantity, 0);
      const spent = result.trades.reduce(
        (sum, trade) => sum + trade.priceInCents * trade.quantity,
        0
      );

      if (got === 0) {
        setMessage("You are in the queue. We will hold your place in order.");
      } else if (got < quantity) {
        setMessage(
          `Got ${got} for $${centsToDollars(spent)}. The rest of your request is queued.`
        );
      } else {
        setMessage(`Got ${got} for $${centsToDollars(spent)}.`);
      }

      onChanged();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Something went wrong");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-5">
      <h3 className="mb-3 text-xs font-medium uppercase tracking-wide text-slate-500">
        {available > 0 ? "Buy" : "Join the queue"}
      </h3>

      <div className="flex items-end gap-3">
        <label className="text-xs text-slate-500">
          How many
          <select
            value={quantity}
            onChange={(event) => setQuantity(Number(event.target.value))}
            className="mt-1 block w-20 rounded border border-slate-800 bg-slate-950 px-2 py-2 text-sm text-slate-100 outline-none focus:border-slate-600"
          >
            {Array.from({ length: allowance }, (_, index) => index + 1).map(
              (option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              )
            )}
          </select>
        </label>

        <button
          onClick={() => void buy()}
          disabled={pending}
          className="flex-1 rounded bg-slate-100 py-2 text-sm font-medium text-slate-900 disabled:opacity-40"
        >
          {pending
            ? "Working"
            : available > 0
              ? `Buy for ${formatPrice(tier.faceValueInCents)} or less`
              : "Join the queue"}
        </button>
      </div>

      <p className="mt-3 text-xs text-slate-600">
        You never pay more than {formatPrice(tier.faceValueInCents)}. If none are
        available you keep your place in line until one is.
      </p>

      {message && <p className="mt-3 text-xs text-emerald-400">{message}</p>}
      {error && <p className="mt-3 text-xs text-rose-400">{error}</p>}
    </div>
  );
}

function SellPanel({
  tier,
  sellable,
  onChanged,
}: {
  tier: Tier;
  sellable: number;
  onChanged: () => void;
}) {
  const [quantity, setQuantity] = useState(1);
  const [price, setPrice] = useState(centsToDollars(tier.faceValueInCents));
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function sell() {
    const cents = dollarsToCents(price);
    if (cents === null) {
      setError("That is not a valid amount");
      return;
    }
    if (cents > tier.faceValueInCents) {
      setError(`You cannot ask more than ${formatPrice(tier.faceValueInCents)}`);
      return;
    }

    setPending(true);
    setError(null);
    setMessage(null);

    try {
      const result = await placeOrder({
        symbol: tier.symbol,
        side: "sell",
        type: "limit",
        priceInCents: cents,
        quantity,
      });

      const sold = result.trades.reduce((sum, trade) => sum + trade.quantity, 0);
      setMessage(
        sold === quantity
          ? `Sold ${sold} to the front of the queue.`
          : sold > 0
            ? `Sold ${sold}. The other ${quantity - sold} are listed.`
            : "Listed. They will sell to whoever is first in line."
      );

      onChanged();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Something went wrong");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-5">
      <h3 className="mb-3 text-xs font-medium uppercase tracking-wide text-slate-500">
        Pass one on
      </h3>

      <div className="flex items-end gap-3">
        <label className="text-xs text-slate-500">
          How many
          <select
            value={quantity}
            onChange={(event) => setQuantity(Number(event.target.value))}
            className="mt-1 block w-20 rounded border border-slate-800 bg-slate-950 px-2 py-2 text-sm text-slate-100 outline-none focus:border-slate-600"
          >
            {Array.from({ length: sellable }, (_, index) => index + 1).map(
              (option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              )
            )}
          </select>
        </label>

        <label className="text-xs text-slate-500">
          Asking
          <input
            value={price}
            onChange={(event) => setPrice(event.target.value)}
            inputMode="decimal"
            className="mt-1 block w-24 rounded border border-slate-800 bg-slate-950 px-2 py-2 text-sm text-slate-100 outline-none focus:border-slate-600"
          />
        </label>

        <button
          onClick={() => void sell()}
          disabled={pending}
          className="flex-1 rounded border border-slate-700 py-2 text-sm font-medium text-slate-200 disabled:opacity-40"
        >
          {pending ? "Working" : "List it"}
        </button>
      </div>

      <p className="mt-3 text-xs text-slate-600">
        Face value is {formatPrice(tier.faceValueInCents)} and you cannot ask more.
        Ask less if you would rather it went quickly.
      </p>

      {message && <p className="mt-3 text-xs text-emerald-400">{message}</p>}
      {error && <p className="mt-3 text-xs text-rose-400">{error}</p>}
    </div>
  );
}
