"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { fetchTickets } from "@/lib/api";
import { formatDate, formatPrice } from "@/lib/format";
import { useAccount } from "@/lib/useAccount";
import { useSession } from "@/lib/session";
import { PassOnPanel, RestingOrders, restingFor } from "@/components/PassOn";
import type { Order, TicketSummary } from "@/lib/types";

export default function TicketsPage() {
  const { user, loading } = useSession();
  const [tickets, setTickets] = useState<TicketSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloads, setReloads] = useState(0);
  const { account, refresh } = useAccount(Boolean(user));

  const changed = useCallback(() => {
    setReloads((count) => count + 1);
    void refresh();
  }, [refresh]);

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
  }, [user, reloads]);

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
to see your tickets.
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
  const orders = account?.orders ?? [];
  const pendingElsewhere = orders.filter(
    (order) =>
      (order.status === "open" || order.status === "partially_filled") &&
      !groups.some((group) => group.symbol === order.symbol)
  );

  return (
    <div>
      <h1 className="font-display text-4xl leading-tight">Your tickets</h1>

      {groups.length === 0 && pendingElsewhere.length === 0 ? (
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

              {group.cancelled && (
                <p className="mt-4 border-l-2 border-accent pl-4 text-sm">
                  Called off. These won&apos;t get anyone in.
                </p>
              )}

              <ul className="mt-4 grid gap-3 sm:grid-cols-2">
                {group.tickets.map((ticket) => (
                  <li key={ticket.id}>
                    <TicketCard ticket={ticket} cancelled={group.cancelled} />
                  </li>
                ))}
              </ul>

              <TierActions
                symbol={group.symbol}
                faceValueInCents={group.faceValueInCents}
                total={group.tickets.length}
                locked={lockedFor(orders, group.symbol)}
                orders={restingFor(orders, group.symbol)}
                cancelled={group.cancelled}
                onChanged={changed}
              />
            </section>
          ))}

          {pendingElsewhere.length > 0 && (
            <section>
              <h2 className="font-display text-2xl leading-tight">
                Waiting in line
              </h2>
              <div className="mt-4">
                <RestingOrders orders={pendingElsewhere} onChanged={changed} />
              </div>
            </section>
          )}
        </div>
      )}
    </div>
  );
}

function TicketCard({
  ticket,
  cancelled,
}: {
  ticket: TicketSummary;
  cancelled: boolean;
}) {
  const note =
    ticket.faceValueInCents === null
      ? ""
      : ticket.faceValueInCents === 0
        ? "Free"
        : `${formatPrice(ticket.faceValueInCents)} at the door`;

  const body = (
    <>
      <span className="font-display text-2xl leading-none">
        No. {ticket.serial}
      </span>
      <span className="eyebrow text-right text-muted">
        {ticket.reserved ? "Passing on" : note}
        {!ticket.reserved && ticket.rotation > 1
          ? ` \u00b7 ${ticket.rotation - 1} held it before you`
          : ""}
      </span>
    </>
  );

  if (ticket.reserved || cancelled) {
    return (
      <div
        className="flex items-baseline justify-between border border-dashed border-rule px-4 py-3 opacity-60"
        title={
          ticket.reserved
            ? "Waiting for somebody to take it. Withdraw to get it back."
            : undefined
        }
      >
        {body}
      </div>
    );
  }

  return (
    <Link
      href={`/pass/${ticket.id}`}
      className="flex items-baseline justify-between border border-rule bg-card px-4 py-3 transition hover:border-ink"
    >
      {body}
    </Link>
  );
}

function lockedFor(
  orders: { symbol: string; side: string; status: string; remainingQuantity: number }[],
  symbol: string
): number {
  return orders
    .filter(
      (order) =>
        order.symbol === symbol &&
        order.side === "sell" &&
        (order.status === "open" || order.status === "partially_filled")
    )
    .reduce((sum, order) => sum + order.remainingQuantity, 0);
}

function TierActions({
  symbol,
  faceValueInCents,
  total,
  locked,
  orders,
  cancelled,
  onChanged,
}: {
  symbol: string;
  faceValueInCents: number | null;
  total: number;
  locked: number;
  orders: Order[];
  cancelled: boolean;
  onChanged: () => void;
}) {
  const sellable = total - locked;

  return (
    <div className="mt-6 max-w-sm space-y-6">
      {!cancelled && sellable > 0 && faceValueInCents !== null && (
        <PassOnPanel
          symbol={symbol}
          faceValueInCents={faceValueInCents}
          sellable={sellable}
          heading="Pass one on"
          onChanged={onChanged}
        />
      )}
      <RestingOrders orders={orders} onChanged={onChanged} />
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
  faceValueInCents: number | null;
  cancelled: boolean;
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
        faceValueInCents: ticket.faceValueInCents,
        cancelled: ticket.eventStatus === "cancelled",
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
