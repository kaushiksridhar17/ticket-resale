"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { fetchEvents } from "@/lib/api";
import {
  NO_FILTERS,
  applyFilters,
  cheapestTier,
  isNarrowed,
  readFilters,
  readRaw,
  spareCount,
  writeFilters,
  type Filters,
  type RawInputs,
  type SortBy,
} from "@/lib/eventFilters";
import { EventFilters } from "./EventFilters";
import { formatDate, formatPrice } from "@/lib/format";
import type { EventSummary } from "@/lib/types";

const EMPTY: RawInputs = { min: "", max: "", from: "", until: "" };

export function Events() {
  // What somebody typed is the state; the numbers and dates are worked
  // out from it every render. The query string is written behind, so a
  // filtered listing survives a reload and can be sent to somebody.
  const fromUrl = useSearchParams();
  const [sort, setSort] = useState<SortBy>(
    () => readFilters(new URLSearchParams(fromUrl.toString())).sort
  );
  const [spareOnly, setSpareOnly] = useState(
    () => readFilters(new URLSearchParams(fromUrl.toString())).spareOnly
  );
  const [raw, setRaw] = useState<RawInputs>(() =>
    readRaw(new URLSearchParams(fromUrl.toString()))
  );

  const [events, setEvents] = useState<EventSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const filters: Filters = {
    ...readFilters(new URLSearchParams(writeFilters(NO_FILTERS, raw))),
    sort,
    spareOnly,
  };
  const query = writeFilters(filters, raw);

  useEffect(() => {
    window.history.replaceState(
      null,
      "",
      query ? `${window.location.pathname}?${query}` : window.location.pathname
    );
  }, [query]);

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

  const shown = events ? applyFilters(events, filters) : [];

  return (
    <div>
      <header className="max-w-xl">
        <h1 className="font-display text-5xl leading-[1.05]">
          Tickets at the price
          <br />
          they were <span className="italic">printed</span> at.
        </h1>
      </header>

      <div className="mt-14">
        {events !== null && events.length > 0 && (
          <EventFilters
            filters={filters}
            raw={raw}
            showing={shown.length}
            total={events.length}
            narrowed={isNarrowed(filters)}
            onSort={setSort}
            onRaw={(changed) =>
              setRaw((current) => ({ ...current, ...changed }))
            }
            onSpareOnly={setSpareOnly}
            onClear={() => {
              setSpareOnly(false);
              setRaw(EMPTY);
            }}
          />
        )}

        {error ? (
          <p className="mt-6 text-sm text-accent">{error}</p>
        ) : events === null ? (
          <p className="mt-6 text-sm text-muted">Loading</p>
        ) : events.length === 0 ? (
          <p className="mt-6 border-t border-rule pt-6 text-sm text-muted">
            Nothing on at the moment.
          </p>
        ) : (
          <ul className="mt-6 border-t border-rule">
            {shown.map((event) => (
              <EventRow key={event.id} event={event} />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function EventRow({ event }: { event: EventSummary }) {
  const available = spareCount(event);
  const waiting = event.tiers.reduce((sum, tier) => sum + tier.waiting, 0);

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
            {formatPrice(cheapestTier(event))}
          </p>
          <p className="eyebrow mt-1.5 text-muted">
            {!event.resaleOpen
              ? event.status === "cancelled"
                ? "Cancelled"
                : "Closed"
              : available > 0
                ? `${available} spare`
                : waiting > 0
                  ? `${waiting} in the queue`
                  : "None spare"}
          </p>
        </div>
      </Link>
    </li>
  );
}
