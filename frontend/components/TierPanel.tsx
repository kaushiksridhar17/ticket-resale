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

  const allowance = tier.perPersonLimit - held - queued;
  const open = event.resaleOpen;

  return (
    <div className="space-y-8">
      <section className="border border-rule bg-card px-6 pb-6 pt-7">
        <div className="flex items-baseline justify-between gap-6">
          <h2 className="font-display text-3xl leading-none">{tier.name}</h2>
          <p className="font-display text-3xl leading-none">
            {formatPrice(tier.faceValueInCents)}
          </p>
        </div>
        <div className="eyebrow mt-2 flex items-baseline justify-between gap-6 text-muted">
          <span>{tier.issued} printed</span>
          <span>Face value</span>
        </div>

        <div className="stub -mx-6 my-6 border-t border-dashed border-rule" />

        <p className="text-sm leading-relaxed">
          {!open
            ? "Resale has closed for this event."
            : available > 0
              ? `${available} spare right now, cheapest at ${formatPrice(cheapest ?? 0)}.`
              : waiting > 0
                ? `None spare. ${waiting} ${waiting === 1 ? "ticket is" : "tickets are"} wanted, and they go in the order people asked.`
                : "None spare right now."}
        </p>
        <p className="eyebrow mt-3 text-muted">
          Limit {tier.perPersonLimit} per person
          {held > 0 ? ` · you hold ${held}` : ""}
        </p>
      </section>

      {!user ? (
        <p className="text-sm text-muted">
          <Link href="/signin" className="text-ink underline decoration-accent underline-offset-4">
            Sign in
          </Link>{" "}
          to take one or join the queue.
        </p>
      ) : !open ? null : (
        <>
          <BuyPanel
            tier={tier}
            available={available}
            allowance={allowance}
            onChanged={onChanged}
          />
          {sellable > 0 && (
            <SellPanel tier={tier} sellable={sellable} onChanged={onChanged} />
          )}
        </>
      )}

      {resting.length > 0 && (
        <section>
          <h3 className="eyebrow text-muted">Your open requests</h3>
          <ul className="mt-3 border-t border-rule">
            {resting.map((order) => (
              <li
                key={order.id}
                className="flex items-baseline justify-between gap-4 border-b border-rule py-3 text-sm"
              >
                <span>
                  {order.side === "buy" ? "Waiting for" : "Offering"}{" "}
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
                  className="eyebrow text-muted hover:text-accent"
                >
                  {order.side === "buy" ? "Leave queue" : "Withdraw"}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function Quantity({
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
      <p className="border-l-2 border-accent pl-4 text-sm text-muted">
        You are holding the most anyone can for this event, {tier.perPersonLimit}.
      </p>
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
        setMessage("You are in the queue. Your place is held in the order you asked.");
      } else if (got < quantity) {
        setMessage(
          `Got ${got} for $${centsToDollars(spent)}. The rest of your request is in the queue.`
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
    <section>
      <h3 className="eyebrow text-muted">
        {available > 0 ? "Take one" : "Join the queue"}
      </h3>

      <div className="mt-3 flex items-end gap-4">
        <Quantity value={quantity} max={allowance} onChange={setQuantity} />
        <button
          onClick={() => void buy()}
          disabled={pending}
          className="eyebrow flex-1 bg-accent py-3.5 text-paper transition hover:bg-ink disabled:opacity-40"
        >
          {pending
            ? "Working"
            : available > 0
              ? `Take ${quantity === 1 ? "it" : "them"} at ${formatPrice(tier.faceValueInCents)} or less`
              : "Put me in the queue"}
        </button>
      </div>

      <p className="mt-3 text-xs leading-relaxed text-muted">
        You never pay more than {formatPrice(tier.faceValueInCents)}, and often
        less. If none are spare you keep your place until one is.
      </p>

      {message && <p className="mt-3 text-sm">{message}</p>}
      {error && <p className="mt-3 text-sm text-accent">{error}</p>}
    </section>
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
      setError("That is not an amount");
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
          ? `Gone, to whoever was first in the queue.`
          : sold > 0
            ? `${sold} gone. The other ${quantity - sold} are up.`
            : "Up for grabs. It goes to whoever is first in line."
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
      <h3 className="eyebrow text-muted">Cannot go? Pass it on</h3>

      <div className="mt-3 flex items-end gap-4">
        <Quantity value={quantity} max={sellable} onChange={setQuantity} />

        <label className="eyebrow text-muted">
          Asking
          <input
            value={price}
            onChange={(event) => setPrice(event.target.value)}
            inputMode="decimal"
            className="mt-1.5 block w-24 border border-rule bg-card px-2 py-2.5 font-sans text-sm text-ink outline-none focus:border-ink"
          />
        </label>

        <button
          onClick={() => void sell()}
          disabled={pending}
          className="eyebrow flex-1 border border-ink py-3.5 text-ink transition hover:bg-ink hover:text-paper disabled:opacity-40"
        >
          {pending ? "Working" : "Pass it on"}
        </button>
      </div>

      <p className="mt-3 text-xs leading-relaxed text-muted">
        Face value is {formatPrice(tier.faceValueInCents)} and you cannot ask
        more. Ask less if you would rather it went quickly.
      </p>

      {message && <p className="mt-3 text-sm">{message}</p>}
      {error && <p className="mt-3 text-sm text-accent">{error}</p>}
    </section>
  );
}
