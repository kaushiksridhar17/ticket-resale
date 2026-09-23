"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { fetchTickets } from "@/lib/api";
import { formatDate, formatPrice } from "@/lib/format";
import { useSession } from "@/lib/session";
import type { TicketSummary } from "@/lib/types";

export default function TicketsPage() {
  const { user, loading } = useSession();
  const [tickets, setTickets] = useState<TicketSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!user) {
      return;
    }

    let cancelled = false;

    fetchTickets()
      .then((result) => {
        if (!cancelled) {
          setTickets(result.tickets);
        }
      })
      .catch((caught: unknown) => {
        if (!cancelled) {
          setError(
            caught instanceof Error ? caught.message : "Could not load your tickets"
          );
        }
      });

    return () => {
      cancelled = true;
    };
  }, [user]);

  if (loading) {
    return <p className="text-sm text-muted">Loading</p>;
  }

  if (!user) {
    return (
      <p className="text-sm text-muted">
        <Link
          href="/signin"
          className="text-ink underline decoration-accent underline-offset-4"
        >
          Sign in
        </Link>{" "}
        to see what you are holding.
      </p>
    );
  }

  if (error) {
    return <p className="text-sm text-accent">{error}</p>;
  }

  if (tickets === null) {
    return <p className="text-sm text-muted">Loading</p>;
  }

  const groups = groupByTier(tickets);

  return (
    <div>
      <h1 className="font-display text-4xl leading-tight">What you are holding</h1>
      <p className="mt-3 max-w-lg text-sm leading-relaxed text-muted">
        Every ticket carries its own number. Tap one to show it at the door. If
        you cannot go, pass it on and it returns to the front of the queue.
      </p>

      {groups.length === 0 ? (
        <p className="mt-10 border-t border-rule pt-6 text-sm text-muted">
          Nothing yet.{" "}
          <Link
            href="/"
            className="text-ink underline decoration-accent underline-offset-4"
          >
            See what is on
          </Link>
          .
        </p>
      ) : (
        <div className="mt-10 space-y-10">
          {groups.map((group) => (
            <section key={group.symbol}>
              <div className="flex items-baseline justify-between gap-6 border-b border-rule pb-3">
                <div>
                  <h2 className="font-display text-2xl leading-tight">
                    {group.eventName}
                  </h2>
                  <p className="eyebrow mt-1.5 text-muted">
                    {group.tierName}
                    {group.venue ? ` · ${group.venue}` : ""}
                    {group.startsAt ? ` · ${formatDate(group.startsAt)}` : ""}
                  </p>
                </div>
                {group.eventId && (
                  <Link
                    href={`/events/${group.eventId}`}
                    className="eyebrow shrink-0 text-muted hover:text-accent"
                  >
                    Event page
                  </Link>
                )}
              </div>

              <ul className="mt-4 grid gap-3 sm:grid-cols-2">
                {group.tickets.map((ticket) => (
                  <li key={ticket.id}>
                    <Link
                      href={`/pass/${ticket.id}`}
                      className="flex items-baseline justify-between border border-rule bg-card px-4 py-3 transition hover:border-ink"
                    >
                      <span className="font-display text-2xl leading-none">
                        No. {ticket.serial}
                      </span>
                      <span className="eyebrow text-right text-muted">
                        {ticket.faceValueInCents === null
                          ? ""
                          : ticket.faceValueInCents === 0
                            ? "Free"
                            : `${formatPrice(ticket.faceValueInCents)} at the door`}
                        {ticket.rotation > 1
                          ? ` · ${ticket.rotation - 1} before you`
                          : ""}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

interface Group {
  symbol: string;
  eventId: string | null;
  eventName: string;
  tierName: string;
  venue: string | null;
  startsAt: number | null;
  tickets: TicketSummary[];
}

function groupByTier(tickets: TicketSummary[]): Group[] {
  const groups = new Map<string, Group>();

  for (const ticket of tickets) {
    let group = groups.get(ticket.symbol);
    if (!group) {
      group = {
        symbol: ticket.symbol,
        eventId: ticket.eventId,
        eventName: ticket.eventName ?? "Unknown event",
        tierName: ticket.tierName ?? ticket.symbol,
        venue: ticket.venue,
        startsAt: ticket.startsAt,
        tickets: [],
      };
      groups.set(ticket.symbol, group);
    }
    group.tickets.push(ticket);
  }

  for (const group of groups.values()) {
    group.tickets.sort((a, b) => a.serial - b.serial);
  }

  return [...groups.values()];
}
