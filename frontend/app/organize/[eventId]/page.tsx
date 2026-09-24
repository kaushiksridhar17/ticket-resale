"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  ApiError,
  cancelEvent,
  closeSales,
  fetchReport,
  issueTickets,
  placeOrder,
} from "@/lib/api";
import {
  centsToDollars,
  dollarsToCents,
  formatDateTime,
  formatPrice,
} from "@/lib/format";
import { useSession } from "@/lib/session";
import type { EventReport, TierReport } from "@/lib/types";

export default function ManageEventPage() {
  const params = useParams();
  const eventId = String(params.eventId ?? "");
  const { user, loading } = useSession();

  const [report, setReport] = useState<EventReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloads, setReloads] = useState(0);

  useEffect(() => {
    if (!user) {
      return;
    }

    let cancelled = false;

    const load = () =>
      fetchReport(eventId)
        .then((result) => {
          if (!cancelled) {
            setReport(result);
            setError(null);
          }
        })
        .catch((caught: unknown) => {
          if (!cancelled) {
            setError(
              caught instanceof ApiError && caught.status === 403
                ? "That\u2019s not your event."
                : "Couldn\u2019t load this event."
            );
          }
        });

    void load();
    const timer = setInterval(() => void load(), 5000);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [eventId, user, reloads]);

  if (loading) {
    return <p className="text-sm text-muted">Loading</p>;
  }

  if (!user || user.role !== "admin") {
    return <p className="text-sm text-muted">Only the admin can see this.</p>;
  }

  if (error) {
    return (
      <div>
        <p className="font-display text-2xl">{error}</p>
        <Link href="/organize" className="eyebrow mt-4 inline-block text-muted">
          ← Your events
        </Link>
      </div>
    );
  }

  if (!report) {
    return <p className="text-sm text-muted">Loading</p>;
  }

  const { event } = report;
  const refresh = () => setReloads((count) => count + 1);

  return (
    <div>
      <Link href="/organize" className="eyebrow text-muted hover:text-ink">
        ← Your events
      </Link>

      <header className="mt-6 flex items-end justify-between gap-6 border-b border-rule pb-8">
        <div>
          <h1 className="font-display text-4xl leading-tight">{event.name}</h1>
          <p className="eyebrow mt-3 text-muted">
            {event.venue} · Doors {formatDateTime(event.startsAt)}
          </p>
          <p className="mt-2 text-xs text-muted">
            {event.status === "cancelled"
              ? "Cancelled. Nothing can change hands."
              : event.resaleOpen
                ? `Resale closes ${formatDateTime(event.salesCloseAt)}`
                : "Resale is closed."}
          </p>
        </div>
        <Link
          href={`/events/${event.id}`}
          className="eyebrow shrink-0 text-muted hover:text-accent"
        >
          See the public page
        </Link>
      </header>

      <div className="mt-10 space-y-12">
        {report.tiers.map((tier) => (
          <TierAdmin
            key={tier.symbol}
            eventId={event.id}
            tier={tier}
            canAct={event.resaleOpen}
            onChanged={refresh}
          />
        ))}
      </div>

      {event.status !== "cancelled" && (
        <EventControls
          eventId={event.id}
          resaleOpen={event.resaleOpen}
          onChanged={refresh}
        />
      )}
    </div>
  );
}

function TierAdmin({
  eventId,
  tier,
  canAct,
  onChanged,
}: {
  eventId: string;
  tier: TierReport;
  canAct: boolean;
  onChanged: () => void;
}) {
  return (
    <section>
      <div className="flex items-baseline justify-between gap-6 border-b border-rule pb-3">
        <h2 className="font-display text-2xl leading-none">{tier.name}</h2>
        <p className="font-display text-2xl leading-none">
          {formatPrice(tier.faceValueInCents)}
        </p>
      </div>

      <dl className="mt-5 grid grid-cols-2 gap-x-6 gap-y-5 sm:grid-cols-4">
        <Stat label="Printed" value={tier.issued} />
        <Stat label="Out with fans" value={tier.withFans} />
        <Stat label="Still yours" value={tier.withOrganizer} />
        <Stat label="People holding" value={tier.holders} />
        <Stat label="Up for resale" value={tier.forSale} />
        <Stat label="Queueing" value={tier.waiting} />
        <Stat label="Passed on again" value={tier.passedOn} />
      </dl>

      {canAct && (
        <div className="mt-8 grid gap-8 sm:grid-cols-2">
          <IssueForm eventId={eventId} tier={tier} onChanged={onChanged} />
          {tier.withOrganizer > 0 && (
            <ReleaseForm tier={tier} onChanged={onChanged} />
          )}
        </div>
      )}

      {tier.recentTrades.length > 0 && (
        <div className="mt-8">
          <h3 className="eyebrow text-muted">Latest hand-overs</h3>
          <ul className="mt-3 border-t border-rule">
            {tier.recentTrades.map((trade, index) => (
              <li
                key={index}
                className="flex items-baseline justify-between border-b border-rule py-2.5 text-sm"
              >
                <span>
                  {trade.quantity} at {formatPrice(trade.priceInCents)}
                </span>
                <span className="eyebrow text-muted">
                  {formatDateTime(trade.executedAt)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <dt className="eyebrow text-muted">{label}</dt>
      <dd className="mt-1 font-display text-3xl leading-none">{value}</dd>
    </div>
  );
}

function IssueForm({
  eventId,
  tier,
  onChanged,
}: {
  eventId: string;
  tier: TierReport;
  onChanged: () => void;
}) {
  const [count, setCount] = useState("100");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function issue() {
    const parsed = Number(count);
    if (!Number.isInteger(parsed) || parsed < 1) {
      setError("That\u2019s not a number");
      return;
    }

    setPending(true);
    setError(null);
    try {
      await issueTickets(eventId, tier.tierId, parsed);
      onChanged();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Couldn\u2019t print those");
    } finally {
      setPending(false);
    }
  }

  return (
    <div>
      <h3 className="eyebrow text-muted">Print more tickets</h3>
      <div className="mt-3 flex items-end gap-3">
        <input
          value={count}
          onChange={(field) => setCount(field.target.value)}
          inputMode="numeric"
          className="w-24 border border-rule bg-card px-3 py-2.5 text-sm outline-none focus:border-ink"
        />
        <button
          onClick={() => void issue()}
          disabled={pending}
          className="eyebrow flex-1 border border-ink py-3 text-ink transition hover:bg-ink hover:text-paper disabled:opacity-40"
        >
          {pending ? "Printing" : "Print them"}
        </button>
      </div>
      <p className="mt-2 text-xs leading-relaxed text-muted">
        They&apos;re yours until you release them.
      </p>
      {error && <p className="mt-2 text-sm text-accent">{error}</p>}
    </div>
  );
}

function ReleaseForm({
  tier,
  onChanged,
}: {
  tier: TierReport;
  onChanged: () => void;
}) {
  const [count, setCount] = useState("");
  const [price, setPrice] = useState(centsToDollars(tier.faceValueInCents));
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function release() {
    const quantity = Number(count);
    if (!Number.isInteger(quantity) || quantity < 1) {
      setError("How many?");
      return;
    }
    if (quantity > tier.withOrganizer) {
      setError(`You only have ${tier.withOrganizer}`);
      return;
    }

    const cents = dollarsToCents(price);
    if (cents === null || cents > tier.faceValueInCents) {
      setError(`Between nothing and ${formatPrice(tier.faceValueInCents)}`);
      return;
    }

    setPending(true);
    setError(null);
    try {
      await placeOrder({
        symbol: tier.symbol,
        side: "sell",
        type: "limit",
        priceInCents: cents,
        quantity,
      });
      setCount("");
      onChanged();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Couldn\u2019t release those");
    } finally {
      setPending(false);
    }
  }

  return (
    <div>
      <h3 className="eyebrow text-muted">Release to fans</h3>
      <div className="mt-3 flex items-end gap-3">
        <input
          value={count}
          onChange={(field) => setCount(field.target.value)}
          inputMode="numeric"
          placeholder={String(tier.withOrganizer)}
          className="w-20 border border-rule bg-card px-3 py-2.5 text-sm outline-none placeholder:text-rule focus:border-ink"
        />
        <input
          value={price}
          onChange={(field) => setPrice(field.target.value)}
          inputMode="decimal"
          className="w-24 border border-rule bg-card px-3 py-2.5 text-sm outline-none focus:border-ink"
        />
        <button
          onClick={() => void release()}
          disabled={pending}
          className="eyebrow flex-1 bg-accent py-3 text-paper transition hover:bg-ink disabled:opacity-40"
        >
          {pending ? "Releasing" : "Release"}
        </button>
      </div>
      <p className="mt-2 text-xs leading-relaxed text-muted">
        Straight to whoever&apos;s been waiting longest.
      </p>
      {error && <p className="mt-2 text-sm text-accent">{error}</p>}
    </div>
  );
}

function EventControls({
  eventId,
  resaleOpen,
  onChanged,
}: {
  eventId: string;
  resaleOpen: boolean;
  onChanged: () => void;
}) {
  const [pending, setPending] = useState(false);
  const [confirming, setConfirming] = useState(false);

  async function run(action: () => Promise<unknown>) {
    setPending(true);
    try {
      await action();
      onChanged();
    } finally {
      setPending(false);
      setConfirming(false);
    }
  }

  return (
    <section className="mt-16 border-t border-rule pt-8">
      <h2 className="eyebrow text-muted">Calling it off</h2>

      <div className="mt-4 flex flex-wrap items-center gap-6">
        {resaleOpen && (
          <button
            onClick={() => void run(() => closeSales(eventId))}
            disabled={pending}
            className="eyebrow border border-ink px-5 py-3 transition hover:bg-ink hover:text-paper disabled:opacity-40"
          >
            Stop resale now
          </button>
        )}

        {confirming ? (
          <div className="flex items-center gap-4">
            <button
              onClick={() => void run(() => cancelEvent(eventId))}
              disabled={pending}
              className="eyebrow bg-accent px-5 py-3 text-paper disabled:opacity-40"
            >
              Yes, cancel the event
            </button>
            <button
              onClick={() => setConfirming(false)}
              className="eyebrow text-muted hover:text-ink"
            >
              Leave it alone
            </button>
          </div>
        ) : (
          <button
            onClick={() => setConfirming(true)}
            className="eyebrow text-muted hover:text-accent"
          >
            Cancel the event
          </button>
        )}
      </div>

      <p className="mt-4 max-w-xl text-xs leading-relaxed text-muted">
        Both clear the queue and hand back anything people had set aside.
        Neither can be undone.
      </p>
    </section>
  );
}
