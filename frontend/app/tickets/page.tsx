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
    return <p className="text-sm text-slate-600">Loading</p>;
  }

  if (!user) {
    return (
      <p className="text-sm text-slate-400">
        <Link href="/signin" className="text-slate-100 underline">
          Sign in
        </Link>{" "}
        to see your tickets.
      </p>
    );
  }

  if (error) {
    return <p className="text-sm text-rose-400">{error}</p>;
  }

  if (tickets === null) {
    return <p className="text-sm text-slate-600">Loading</p>;
  }

  const groups = groupByTier(tickets);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">My tickets</h1>
        <p className="mt-1 text-sm text-slate-500">
          Each ticket has its own number. Passing one on moves that exact ticket.
        </p>
      </div>

      {groups.length === 0 ? (
        <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-8 text-center">
          <p className="text-sm text-slate-400">You do not hold any tickets.</p>
          <Link
            href="/"
            className="mt-2 inline-block text-xs text-slate-500 underline"
          >
            Browse events
          </Link>
        </div>
      ) : (
        groups.map((group) => (
          <div
            key={group.symbol}
            className="rounded-lg border border-slate-800 bg-slate-900/40 p-5"
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="font-medium">{group.eventName}</h2>
                <p className="mt-1 text-xs text-slate-500">
                  {group.tierName}
                  {group.venue ? ` · ${group.venue}` : ""}
                  {group.startsAt ? ` · ${formatDate(group.startsAt)}` : ""}
                </p>
              </div>
              {group.eventId && (
                <Link
                  href={`/events/${group.eventId}`}
                  className="shrink-0 text-xs text-slate-500 underline hover:text-slate-300"
                >
                  event page
                </Link>
              )}
            </div>

            <ul className="mt-4 grid gap-2 sm:grid-cols-2">
              {group.tickets.map((ticket) => (
                <li
                  key={ticket.id}
                  className="flex items-center justify-between rounded border border-slate-800 bg-slate-950 px-3 py-2"
                >
                  <span className="font-mono text-sm">#{ticket.serial}</span>
                  <span className="text-xs text-slate-600">
                    {ticket.faceValueInCents === null
                      ? ""
                      : formatPrice(ticket.faceValueInCents)}
                    {ticket.rotation > 1
                      ? ` · passed on ${ticket.rotation - 1}×`
                      : ""}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ))
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
