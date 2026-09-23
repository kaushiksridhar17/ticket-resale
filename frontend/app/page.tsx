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

  return (
    <div>
      <header className="max-w-xl">
        <p className="eyebrow text-accent">No markup, no touts</p>
        <h1 className="mt-3 font-display text-5xl leading-[1.05]">
          Tickets at the price
          <br />
          they were <span className="italic">printed</span> at.
        </h1>
        <p className="mt-5 text-sm leading-relaxed text-muted">
          When somebody can no longer go, their ticket comes back here and goes
          to whoever has been waiting longest. Never for more than face value.
        </p>
      </header>

      <div className="mt-14">
        <h2 className="eyebrow text-muted">What is on</h2>

        {error ? (
          <p className="mt-6 text-sm text-accent">{error}</p>
        ) : events === null ? (
          <p className="mt-6 text-sm text-muted">Loading</p>
        ) : events.length === 0 ? (
          <p className="mt-6 border-t border-rule pt-6 text-sm text-muted">
            Nothing yet. An organizer needs to put an event up before tickets can
            change hands.
          </p>
        ) : (
          <ul className="mt-4 border-t border-rule">
            {events.map((event) => (
              <EventRow key={event.id} event={event} />
            ))}
          </ul>
        )}
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
    <li className="border-b border-rule">
      <Link
        href={`/events/${event.id}`}
        className="group -mx-4 flex items-baseline justify-between gap-6 px-4 py-6 transition hover:bg-card"
      >
        <div>
          <h3 className="font-display text-2xl leading-tight group-hover:text-accent">
            {event.name}
          </h3>
          <p className="mt-1.5 text-sm text-muted">
            {event.venue} · {formatDate(event.startsAt)}
          </p>
        </div>

        <div className="shrink-0 text-right">
          <p className="font-display text-xl">
            {event.tiers.length > 1 ? "from " : ""}
            {formatPrice(cheapest ?? 0)}
          </p>
          <p className="eyebrow mt-1.5 text-muted">
            {!event.resaleOpen
              ? event.status === "cancelled"
                ? "Cancelled"
                : "Closed"
              : available > 0
                ? `${available} available`
                : waiting > 0
                  ? `${waiting} in the queue`
                  : "None spare"}
          </p>
        </div>
      </Link>
    </li>
  );
}
