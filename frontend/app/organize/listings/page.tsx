"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  ApiError,
  approveListing,
  evidenceUrl,
  fetchListings,
  rejectListing,
} from "@/lib/api";
import { formatDate, formatPrice } from "@/lib/format";
import { useSession } from "@/lib/session";
import { StatusTag } from "@/components/StatusTag";
import type { ListingStatus, ListingSummary } from "@/lib/types";

const TABS: { value: ListingStatus | "all"; label: string }[] = [
  { value: "pending", label: "Waiting" },
  { value: "approved", label: "Approved" },
  { value: "rejected", label: "Turned down" },
  { value: "all", label: "Everything" },
];

export default function ListingsPage() {
  const { user, loading } = useSession();
  const [tab, setTab] = useState<ListingStatus | "all">("pending");
  const [listings, setListings] = useState<ListingSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloads, setReloads] = useState(0);

  const reload = useCallback(() => setReloads((count) => count + 1), []);

  useEffect(() => {
    if (!user || user.role !== "admin") {
      return;
    }

    let cancelled = false;
    setListings(null);
    fetchListings(tab === "all" ? undefined : tab)
      .then((result) => {
        if (!cancelled) {
          setListings(result.listings);
          setError(null);
        }
      })
      .catch((caught: unknown) => {
        if (!cancelled) {
          setError(
            caught instanceof Error ? caught.message : "Could not load listings"
          );
        }
      });

    return () => {
      cancelled = true;
    };
  }, [user, tab, reloads]);

  if (loading) {
    return <p className="text-sm text-muted">Loading</p>;
  }

  if (!user || user.role !== "admin") {
    return <p className="text-sm text-muted">You do not have access to this page.</p>;
  }

  return (
    <div>
      <div className="flex items-end justify-between gap-6">
        <h1 className="font-display text-4xl leading-tight">Submitted tickets</h1>
        <Link href="/organize" className="eyebrow shrink-0 text-muted hover:text-accent">
          Events
        </Link>
      </div>

      <div className="mt-8 flex gap-6 border-b border-rule">
        {TABS.map((option) => (
          <button
            key={option.value}
            onClick={() => setTab(option.value)}
            className={`eyebrow -mb-px border-b-2 pb-2 transition ${
              tab === option.value
                ? "border-accent text-ink"
                : "border-transparent text-muted hover:text-ink"
            }`}
          >
            {option.label}
          </button>
        ))}
      </div>

      {error ? (
        <p className="mt-6 text-sm text-accent">{error}</p>
      ) : listings === null ? (
        <p className="mt-6 text-sm text-muted">Loading</p>
      ) : listings.length === 0 ? (
        <p className="mt-6 text-sm text-muted">Nothing here.</p>
      ) : (
        <ul className="mt-8 space-y-10">
          {listings.map((listing) => (
            <ListingRow key={listing.id} listing={listing} onDecided={reload} />
          ))}
        </ul>
      )}
    </div>
  );
}

function ListingRow({
  listing,
  onDecided,
}: {
  listing: ListingSummary;
  onDecided: () => void;
}) {
  const [reason, setReason] = useState("");
  const [rejecting, setRejecting] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(action: () => Promise<unknown>) {
    setPending(true);
    setError(null);
    try {
      await action();
      onDecided();
    } catch (caught) {
      setError(
        caught instanceof ApiError ? caught.message : "Something went wrong"
      );
      setPending(false);
    }
  }

  return (
    <li className="border-b border-rule pb-10">
      <div className="flex flex-wrap items-start gap-8">
        <a
          href={evidenceUrl(listing.id)}
          target="_blank"
          rel="noreferrer"
          className="block shrink-0 border border-rule"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={evidenceUrl(listing.id)}
            alt={`Ticket submitted for ${listing.eventName ?? listing.eventId}`}
            className="h-40 w-40 bg-card object-cover"
          />
        </a>

        <div className="min-w-[16rem] flex-1">
          <div className="flex items-baseline justify-between gap-6">
            <h2 className="font-display text-2xl leading-tight">
              {listing.eventName ?? listing.eventId}
            </h2>
            <StatusTag status={listing.status} />
          </div>

          <p className="mt-2 text-sm text-muted">
            {listing.tierName}
            {listing.faceValueInCents !== null
              ? ` · ${formatPrice(listing.faceValueInCents)} each`
              : ""}
            {" · "}
            {listing.quantity} {listing.quantity === 1 ? "ticket" : "tickets"}
          </p>
          <p className="eyebrow mt-2 text-muted">
            {listing.venue}
            {listing.startsAt ? ` · ${formatDate(listing.startsAt)}` : ""}
          </p>

          {listing.note && (
            <p className="mt-3 border-l-2 border-rule pl-4 text-sm">
              {listing.note}
            </p>
          )}

          {listing.status === "rejected" && listing.reason && (
            <p className="mt-3 border-l-2 border-accent pl-4 text-sm">
              {listing.reason}
            </p>
          )}

          {listing.status === "pending" && (
            <div className="mt-5">
              {rejecting ? (
                <div className="max-w-sm">
                  <label className="block">
                    <span className="eyebrow text-muted">Why</span>
                    <input
                      value={reason}
                      onChange={(field) => setReason(field.target.value)}
                      maxLength={300}
                      autoFocus
                      className="mt-1.5 w-full border-b border-ink bg-transparent pb-2 text-sm outline-none focus:border-accent"
                    />
                  </label>
                  <div className="mt-4 flex gap-3">
                    <button
                      onClick={() =>
                        void run(() => rejectListing(listing.id, reason.trim()))
                      }
                      disabled={pending || reason.trim().length === 0}
                      className="eyebrow border border-accent px-4 py-2.5 text-accent transition hover:bg-accent hover:text-paper disabled:opacity-40"
                    >
                      Turn it down
                    </button>
                    <button
                      onClick={() => {
                        setRejecting(false);
                        setReason("");
                      }}
                      className="eyebrow text-muted hover:text-ink"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex gap-3">
                  <button
                    onClick={() => void run(() => approveListing(listing.id))}
                    disabled={pending}
                    className="eyebrow bg-accent px-5 py-2.5 text-paper transition hover:bg-ink disabled:opacity-40"
                  >
                    {pending ? "Working" : "Approve"}
                  </button>
                  <button
                    onClick={() => setRejecting(true)}
                    disabled={pending}
                    className="eyebrow border border-rule px-5 py-2.5 text-muted transition hover:border-ink hover:text-ink disabled:opacity-40"
                  >
                    Turn down
                  </button>
                </div>
              )}

              {error && <p className="mt-3 text-sm text-accent">{error}</p>}
            </div>
          )}
        </div>
      </div>
    </li>
  );
}
