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
                ? "That event does not exist."
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
      <div className="space-y-3">
        <p className="text-sm text-rose-400">{error}</p>
        <Link href="/" className="text-sm text-slate-400 underline">
          Back to events
        </Link>
      </div>
    );
  }

  if (!event) {
    return <p className="text-sm text-slate-600">Loading</p>;
  }

  const selected =
    event.tiers.find((tier) => tier.tierId === tierId) ?? event.tiers[0];

  return (
    <div className="space-y-6">
      <div>
        <Link href="/" className="text-xs text-slate-500 hover:text-slate-300">
          ← All events
        </Link>
        <h1 className="mt-3 text-2xl font-semibold tracking-tight">{event.name}</h1>
        <p className="mt-1 text-sm text-slate-500">
          {event.venue} · {formatDate(event.startsAt)}
        </p>
        {event.status === "cancelled" ? (
          <p className="mt-3 rounded border border-rose-900 bg-rose-500/10 px-3 py-2 text-xs text-rose-300">
            This event has been cancelled.
          </p>
        ) : event.status === "closed" ? (
          <p className="mt-3 rounded border border-slate-800 bg-slate-900/60 px-3 py-2 text-xs text-slate-400">
            Resale has closed.
          </p>
        ) : (
          <p className="mt-2 text-xs text-slate-600">
            Resale closes {formatDateTime(event.salesCloseAt)}
          </p>
        )}
      </div>

      {event.tiers.length > 1 && (
        <div className="flex flex-wrap gap-2">
          {event.tiers.map((tier) => (
            <button
              key={tier.tierId}
              onClick={() => setTierId(tier.tierId)}
              className={`rounded px-3 py-1.5 text-sm transition ${
                tier.tierId === selected?.tierId
                  ? "bg-slate-100 text-slate-900"
                  : "bg-slate-900 text-slate-400 hover:bg-slate-800"
              }`}
            >
              {tier.name}
            </button>
          ))}
        </div>
      )}

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
  );
}
