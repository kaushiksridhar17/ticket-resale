"use client";

import { useState } from "react";
import Link from "next/link";
import { ApiError, placeOrder } from "@/lib/api";
import { centsToDollars, formatPrice } from "@/lib/format";
import { useExchangeSocket } from "@/lib/useExchangeSocket";
import { PassOnPanel, Quantity, RestingOrders, restingFor } from "./PassOn";
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

  const resting = restingFor(account?.orders ?? [], tier.symbol);
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
                ? `None spare. ${waiting} in the queue.`
                : "None spare."}
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
          {user.buys || user.role === "admin" ? (
            <BuyPanel
              tier={tier}
              available={available}
              allowance={allowance}
              onChanged={onChanged}
            />
          ) : (
            <p className="text-sm text-muted">
              Buying is off for this account.{" "}
              <Link
                href="/settings"
                className="text-ink underline decoration-accent underline-offset-4"
              >
                Turn it on
              </Link>
              .
            </p>
          )}
          {sellable > 0 && (
            <PassOnPanel
              symbol={tier.symbol}
              faceValueInCents={tier.faceValueInCents}
              sellable={sellable}
              onChanged={onChanged}
            />
          )}
        </>
      )}

      <RestingOrders orders={resting} onChanged={onChanged} />
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
      <p className="border-l-2 border-accent pl-4 text-sm text-muted">
        You have {tier.perPersonLimit}, the limit for this event.
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
        spent === 0 ? "Nothing to pay." : `$${centsToDollars(spent)} at the door.`;

      if (got === 0) {
        setMessage("In the queue.");
      } else if (got < quantity) {
        setMessage(`${got} claimed, ${quantity - got} queued. ${owed}`);
      } else {
        setMessage(`Claimed. ${owed}`);
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

      <p className="mt-3 text-xs text-muted">
        {tier.faceValueInCents === 0
          ? "Free entry."
          : `${formatPrice(tier.faceValueInCents)}, paid at the door.`}
      </p>

      {message && <p className="mt-3 text-sm">{message}</p>}
      {error && <p className="mt-3 text-sm text-accent">{error}</p>}
    </section>
  );
}
