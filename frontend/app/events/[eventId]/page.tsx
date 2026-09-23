"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ApiError, fetchEvent } from "@/lib/api";
import { formatDate, formatDateTime } from "@/lib/format";
import { useAccount } from "@/lib/useAccount";
import { useSession } from "@/lib/session";
import { TierPanel } from "@/components/TierPanel";
import type { EventSummary } from "@/lib/types";

export default function EventPage() {
  const params = useParams();
  const eventId = String(params.eventId ?? "");

  const { user } = useSession();
  const { account, refresh } = useAccount(user !== null);
  const [event, setEvent] = useState<EventSummary | null>(null);
  const [tierId, setTierId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const load = () =>
      fetchEvent(eventId)
        .then((result) => {
          if (!cancelled) {
            setEvent(result.event);
            setError(null);
          }
        })
        .catch((caught: unknown) => {
          if (!cancelled) {
            setError(
              caught instanceof ApiError && caught.status === 404
                ? "There is no such event."
                : "Could not load this event."
            );
          }
        });

    void load();
    const timer = setInterval(() => void load(), 5000);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [eventId]);

  if (error) {
    return (
      <div>
        <p className="font-display text-2xl">{error}</p>
        <Link
          href="/"
          className="eyebrow mt-4 inline-block text-muted hover:text-ink"
        >
          ← Everything that is on
        </Link>
      </div>
    );
  }

  if (!event) {
    return <p className="text-sm text-muted">Loading</p>;
  }

  const selected =
    event.tiers.find((tier) => tier.tierId === tierId) ?? event.tiers[0];

  return (
    <div>
      <Link href="/" className="eyebrow text-muted hover:text-ink">
        ← Everything that is on
      </Link>

      <header className="mt-6 border-b border-rule pb-8">
        <h1 className="font-display text-5xl leading-[1.05]">{event.name}</h1>
        <p className="eyebrow mt-4 text-muted">
          {event.venue} · {formatDate(event.startsAt)}
        </p>

        {event.status === "cancelled" ? (
          <p className="mt-5 border-l-2 border-accent pl-4 text-sm">
            This event has been cancelled.
          </p>
        ) : !event.resaleOpen ? (
          <p className="mt-5 border-l-2 border-rule pl-4 text-sm text-muted">
            Resale has closed.
          </p>
        ) : (
          <p className="mt-3 text-xs text-muted">
            Resale closes {formatDateTime(event.salesCloseAt)}
          </p>
        )}
      </header>

      {event.tiers.length > 1 && (
        <div className="mt-8 flex flex-wrap gap-6">
          {event.tiers.map((tier) => (
            <button
              key={tier.tierId}
              onClick={() => setTierId(tier.tierId)}
              className={`eyebrow border-b-2 pb-1 transition ${
                tier.tierId === selected?.tierId
                  ? "border-accent text-ink"
                  : "border-transparent text-muted hover:text-ink"
              }`}
            >
              {tier.name}
            </button>
          ))}
        </div>
      )}

      <div className="mt-8">
        {selected && (
          <TierPanel
            key={selected.symbol}
            event={event}
            tier={selected}
            user={user}
            account={account}
            onChanged={() => void refresh()}
          />
        )}
      </div>
    </div>
  );
}
