"use client";

import { useState } from "react";
import Link from "next/link";
import { ApiError, cancelOrder, placeOrder } from "@/lib/api";
import { centsToDollars, formatPrice } from "@/lib/format";
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
          <span>
            {tier.faceValueInCents === 0 ? "Free" : "Paid at the door"}
          </span>
        </div>

        <div className="stub -mx-6 my-6 border-t border-dashed border-rule" />

        <p className="text-sm leading-relaxed">
          {!open
            ? "Resale has closed."
            : available > 0
              ? `${available} spare, from ${formatPrice(cheapest ?? 0)}.`
              : waiting > 0
                ? `None spare. ${waiting} already waiting.`
                : "None spare just now."}
        </p>
        <p className="eyebrow mt-3 text-muted">
          Max {tier.perPersonLimit} each
          {held > 0 ? ` · you have ${held}` : ""}
        </p>
      </section>

      {!user ? (
        <p className="text-sm text-muted">
          <Link href="/signin" className="text-ink underline decoration-accent underline-offset-4">
            Sign in
          </Link>{" "}
          to claim one or join the queue.
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
            <PassOnPanel tier={tier} sellable={sellable} onChanged={onChanged} />
          )}
        </>
      )}

      {resting.length > 0 && (
        <section>
          <h3 className="eyebrow text-muted">Pending</h3>
          <ul className="mt-3 border-t border-rule">
            {resting.map((order) => (
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
        You&apos;ve got {tier.perPersonLimit}, which is the limit here.
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

      const owed =
        spent === 0 ? "Nothing to pay." : `$${centsToDollars(spent)} on the night.`;

      if (got === 0) {
        setMessage("You're in the queue.");
      } else if (got < quantity) {
        setMessage(`${got} yours. ${owed} The rest are queued.`);
      } else {
        setMessage(`${got === 1 ? "It's" : "They're"} yours. ${owed}`);
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
        {available > 0 ? "Claim a ticket" : "Join the queue"}
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
              ? `Claim ${quantity === 1 ? "one" : `${quantity}`}`
              : "Put me in the queue"}
        </button>
      </div>

      <p className="mt-3 text-xs leading-relaxed text-muted">
        {tier.faceValueInCents === 0
          ? "Free entry. Nothing to pay, here or at the door."
          : `You'll pay the venue ${formatPrice(tier.faceValueInCents)} on the night, never more.`}
      </p>

      {message && <p className="mt-3 text-sm">{message}</p>}
      {error && <p className="mt-3 text-sm text-accent">{error}</p>}
    </section>
  );
}

function PassOnPanel({
  tier,
  sellable,
  onChanged,
}: {
  tier: Tier;
  sellable: number;
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
        symbol: tier.symbol,
        side: "sell",
        type: "limit",
        priceInCents: tier.faceValueInCents,
        quantity,
      });

      const gone = result.trades.reduce((sum, trade) => sum + trade.quantity, 0);
      setMessage(
        gone === quantity
          ? "Gone, to whoever was first in line."
          : gone > 0
            ? `${gone} gone, ${quantity - gone} waiting for someone.`
            : "Back in the queue."
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
      <h3 className="eyebrow text-muted">Can&apos;t go?</h3>

      <div className="mt-3 flex items-end gap-4">
        <Quantity value={quantity} max={sellable} onChange={setQuantity} />
        <button
          onClick={() => void passOn()}
          disabled={pending}
          className="eyebrow flex-1 border border-ink py-3.5 text-ink transition hover:bg-ink hover:text-paper disabled:opacity-40"
        >
          {pending ? "Working" : "Pass it on"}
        </button>
      </div>

      <p className="mt-3 text-xs leading-relaxed text-muted">
        Straight back in the queue, to whoever&apos;s been waiting longest.
      </p>

      {message && <p className="mt-3 text-sm">{message}</p>}
      {error && <p className="mt-3 text-sm text-accent">{error}</p>}
    </section>
  );
}
