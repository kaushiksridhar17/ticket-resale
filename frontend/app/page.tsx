"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { fetchEvents } from "@/lib/api";
import { formatDate, formatPrice } from "@/lib/format";
import type { EventSummary } from "@/lib/types";

export default function EventsPage() {
  const [events, setEvents] = useState<EventSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const load = () =>
      fetchEvents()
        .then((result) => {
          if (!cancelled) {
            setEvents(result.events);
            setError(null);
          }
        })
        .catch((caught: unknown) => {
          if (!cancelled) {
            setError(
              caught instanceof Error ? caught.message : "Could not load events"
            );
          }
        });

    void load();
    const timer = setInterval(() => void load(), 5000);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  if (error) {
    return <p className="text-sm text-rose-400">{error}</p>;
  }

  if (events === null) {
    return <p className="text-sm text-slate-600">Loading</p>;
  }

  if (events.length === 0) {
    return (
      <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-8 text-center">
        <p className="text-sm text-slate-400">No events yet.</p>
        <p className="mt-2 text-xs text-slate-600">
          An organizer needs to create one before tickets can change hands.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Events</h1>
        <p className="mt-1 text-sm text-slate-500">
          Every ticket here sells for face value or less, first come first served.
        </p>
      </div>

      <div className="space-y-3">
        {events.map((event) => (
          <EventRow key={event.id} event={event} />
        ))}
      </div>
    </div>
  );
}

function EventRow({ event }: { event: EventSummary }) {
  const available = event.tiers.reduce((sum, tier) => sum + tier.forSale, 0);
  const waiting = event.tiers.reduce((sum, tier) => sum + tier.waiting, 0);
  const cheapest = event.tiers
    .map((tier) => tier.faceValueInCents)
    .sort((a, b) => a - b)[0];

  return (
    <Link
      href={`/events/${event.id}`}
      className="block rounded-lg border border-slate-800 bg-slate-900/40 p-5 transition hover:border-slate-700 hover:bg-slate-900/70"
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="font-medium">{event.name}</h2>
          <p className="mt-1 text-xs text-slate-500">
            {event.venue} · {formatDate(event.startsAt)}
          </p>
        </div>
        <StatusBadge event={event} />
      </div>

      <p className="mt-4 text-xs text-slate-400">
        {!event.resaleOpen
          ? "Resale is closed"
          : available > 0
            ? `${available} available from ${formatPrice(cheapest ?? 0)}`
            : waiting > 0
              ? `Sold out · ${waiting} wanted`
              : "Sold out"}
      </p>
    </Link>
  );
}

function StatusBadge({ event }: { event: EventSummary }) {
  if (event.status === "cancelled") {
    return (
      <span className="rounded-full bg-rose-500/10 px-2.5 py-1 text-[11px] text-rose-300">
        Cancelled
      </span>
    );
  }
  if (event.status === "closed") {
    return (
      <span className="rounded-full bg-slate-700/40 px-2.5 py-1 text-[11px] text-slate-400">
        Closed
      </span>
    );
  }
  return (
    <span className="rounded-full bg-emerald-500/10 px-2.5 py-1 text-[11px] text-emerald-300">
      On sale
    </span>
  );
}
