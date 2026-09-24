"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { fetchListings } from "@/lib/api";
import { formatDate, formatPrice } from "@/lib/format";
import { useSession } from "@/lib/session";
import { SellForm } from "@/components/SellForm";
import { StatusTag } from "@/components/StatusTag";
import type { ListingSummary } from "@/lib/types";

export default function SellPage() {
  const { user, loading } = useSession();
  const [listings, setListings] = useState<ListingSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloads, setReloads] = useState(0);

  const reload = useCallback(() => setReloads((count) => count + 1), []);

  useEffect(() => {
    if (!user) {
      return;
    }

    let cancelled = false;
    fetchListings()
      .then((result) => {
        if (!cancelled) {
          setListings(result.listings);
          setError(null);
        }
      })
      .catch((caught: unknown) => {
        if (!cancelled) {
          setError(
            caught instanceof Error ? caught.message : "Could not load your listings"
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
        to put up a ticket.
      </p>
    );
  }

  if (!user.sells && user.role !== "admin") {
    return (
      <p className="text-sm text-muted">
        Selling is off for this account.{" "}
        <Link
          href="/settings"
          className="text-ink underline decoration-accent underline-offset-4"
        >
          Turn it on
        </Link>
        .
      </p>
    );
  }

  return (
    <div>
      <h1 className="font-display text-4xl leading-tight">Sell a ticket</h1>
      <p className="mt-3 max-w-lg text-sm leading-relaxed text-muted">
        Submit the ticket with a photo of it. Once it is checked, it goes on
        sale at the face value printed on the event.
      </p>

      <div className="mt-10">
        <SellForm onSubmitted={reload} />
      </div>

      <div className="mt-14">
        <h2 className="eyebrow text-muted">What you have submitted</h2>

        {error ? (
          <p className="mt-4 text-sm text-accent">{error}</p>
        ) : listings === null ? (
          <p className="mt-4 text-sm text-muted">Loading</p>
        ) : listings.length === 0 ? (
          <p className="mt-4 border-t border-rule pt-6 text-sm text-muted">
            Nothing yet.
          </p>
        ) : (
          <ul className="mt-4 border-t border-rule">
            {listings.map((listing) => (
              <li key={listing.id} className="border-b border-rule py-5">
                <div className="flex items-baseline justify-between gap-6">
                  <div>
                    <h3 className="font-display text-xl leading-tight">
                      {listing.eventName ?? listing.eventId}
                    </h3>
                    <p className="mt-1.5 text-sm text-muted">
                      {listing.tierName}
                      {listing.faceValueInCents !== null
                        ? ` · ${formatPrice(listing.faceValueInCents)}`
                        : ""}
                      {" · "}
                      {listing.quantity}{" "}
                      {listing.quantity === 1 ? "ticket" : "tickets"}
                      {listing.startsAt
                        ? ` · ${formatDate(listing.startsAt)}`
                        : ""}
                    </p>
                  </div>
                  <StatusTag status={listing.status} />
                </div>

                {listing.note && (
                  <p className="mt-3 text-sm text-muted">{listing.note}</p>
                )}

                {listing.status === "rejected" && listing.reason && (
                  <p className="mt-3 border-l-2 border-accent pl-4 text-sm">
                    {listing.reason}
                  </p>
                )}

                {listing.status === "approved" && (
                  <p className="mt-3 text-sm text-muted">
                    On sale now.{" "}
                    <Link
                      href="/tickets"
                      className="text-ink underline decoration-accent underline-offset-4"
                    >
                      Your tickets
                    </Link>
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
