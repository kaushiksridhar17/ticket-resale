"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { fetchEvents } from "@/lib/api";
import { formatDate } from "@/lib/format";
import { useSession } from "@/lib/session";
import type { EventSummary } from "@/lib/types";

export default function OrganizePage() {
  const { user, loading } = useSession();
  const [events, setEvents] = useState<EventSummary[] | null>(null);

  useEffect(() => {
    if (!user) {
      return;
    }

    let cancelled = false;

    fetchEvents()
      .then((result) => {
        if (!cancelled) {
          setEvents(result.events);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setEvents([]);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [user]);

  if (loading) {
    return <p className="text-sm text-muted">Loading</p>;
  }

  if (!user || user.role !== "admin") {
    return (
      <div className="max-w-lg">
        <h1 className="font-display text-4xl leading-tight">Admin</h1>
        <p className="mt-4 text-sm text-muted">
          You do not have access to this page.
        </p>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-end justify-between gap-6">
        <h1 className="font-display text-4xl leading-tight">Your events</h1>
        <Link
          href="/organize/new"
          className="eyebrow shrink-0 bg-accent px-5 py-3 text-paper transition hover:bg-ink"
        >
          Put on an event
        </Link>
      </div>

      {events === null ? (
        <p className="mt-10 text-sm text-muted">Loading</p>
      ) : events.length === 0 ? (
        <p className="mt-10 border-t border-rule pt-6 text-sm text-muted">
          No events yet.
        </p>
      ) : (
        <ul className="mt-8 border-t border-rule">
          {events.map((event) => {
            const issued = event.tiers.reduce(
              (sum, tier) => sum + tier.issued,
              0
            );
            return (
              <li key={event.id} className="border-b border-rule">
                <Link
                  href={`/organize/${event.id}`}
                  className="group -mx-4 flex items-baseline justify-between gap-6 px-4 py-6 transition hover:bg-card"
                >
                  <div>
                    <h2 className="font-display text-2xl leading-tight group-hover:text-accent">
                      {event.name}
                    </h2>
                    <p className="mt-1.5 text-sm text-muted">
                      {event.venue} · {formatDate(event.startsAt)}
                    </p>
                  </div>
                  <p className="eyebrow shrink-0 text-right text-muted">
                    {issued === 0 ? "No tickets yet" : `${issued} printed`}
                    <br />
                    {event.status === "cancelled"
                      ? "Cancelled"
                      : event.resaleOpen
                        ? "On sale"
                        : "Closed"}
                  </p>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
