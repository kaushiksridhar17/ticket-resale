"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ApiError, createEvent } from "@/lib/api";
import { dollarsToCents } from "@/lib/format";
import { useSession } from "@/lib/session";
import type { NewTier } from "@/lib/types";

interface TierDraft {
  name: string;
  price: string;
  limit: string;
}

const BLANK: TierDraft = { name: "", price: "", limit: "4" };

export default function NewEventPage() {
  const router = useRouter();
  const { user, loading } = useSession();

  const [name, setName] = useState("");
  const [venue, setVenue] = useState("");
  const [doors, setDoors] = useState("");
  const [closes, setCloses] = useState("");
  const [tiers, setTiers] = useState<TierDraft[]>([{ ...BLANK }]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (loading) {
    return <p className="text-sm text-muted">Loading</p>;
  }

  if (!user || user.role !== "organizer") {
    return (
      <p className="text-sm text-muted">
        Only organizers can put on an event.{" "}
        <Link
          href="/organize"
          className="text-ink underline decoration-accent underline-offset-4"
        >
          More about that
        </Link>
        .
      </p>
    );
  }

  function updateTier(index: number, patch: Partial<TierDraft>) {
    setTiers((current) =>
      current.map((tier, position) =>
        position === index ? { ...tier, ...patch } : tier
      )
    );
  }

  function suggestDates() {
    const doorsAt = new Date();
    doorsAt.setDate(doorsAt.getDate() + 14);
    doorsAt.setHours(20, 0, 0, 0);

    const closesAt = new Date(doorsAt);
    closesAt.setHours(18, 0, 0, 0);

    setDoors(toLocalInput(doorsAt));
    setCloses(toLocalInput(closesAt));
  }

  async function submit(formEvent: React.FormEvent) {
    formEvent.preventDefault();
    setError(null);

    const startsAt = new Date(doors).getTime();
    const salesCloseAt = new Date(closes).getTime();

    if (!Number.isFinite(startsAt) || !Number.isFinite(salesCloseAt)) {
      setError("Both times are needed");
      return;
    }
    if (salesCloseAt <= Date.now()) {
      setError("Resale has to close some time in the future");
      return;
    }
    if (salesCloseAt > startsAt) {
      setError("Resale can\u2019t close after the doors open");
      return;
    }

    const prepared: NewTier[] = [];
    const used = new Set<string>();

    for (const [index, tier] of tiers.entries()) {
      if (tier.name.trim().length === 0) {
        setError("Every tier needs a name");
        return;
      }
      const cents = dollarsToCents(tier.price.trim() === "" ? "0" : tier.price);
      if (cents === null) {
        setError(`"${tier.price}" is not a price`);
        return;
      }
      const limit = Number(tier.limit);
      if (!Number.isInteger(limit) || limit < 1 || limit > 50) {
        setError("Limit has to be between 1 and 50");
        return;
      }

      prepared.push({
        tierId: uniqueSlug(tier.name, index, used),
        name: tier.name.trim(),
        faceValueInCents: cents,
        perPersonLimit: limit,
      });
    }

    setPending(true);
    try {
      const result = await createEvent({
        name: name.trim(),
        venue: venue.trim(),
        startsAt,
        salesCloseAt,
        tiers: prepared,
      });
      router.push(`/organize/${result.event.id}`);
    } catch (caught) {
      setError(
        caught instanceof ApiError ? caught.message : "Couldn\u2019t put that on"
      );
      setPending(false);
    }
  }

  return (
    <div className="max-w-2xl">
      <Link href="/organize" className="eyebrow text-muted hover:text-ink">
        ← Your events
      </Link>
      <h1 className="mt-6 font-display text-4xl leading-tight">
        Put on an event
      </h1>
      <p className="mt-3 text-sm leading-relaxed text-muted">
        Whatever you set as face value is the ceiling, permanently. Nobody can
        go above it, including you.
      </p>

      <form onSubmit={submit} className="mt-10 space-y-10">
        <section className="space-y-5">
          <Field label="What is it">
            <input
              value={name}
              onChange={(field) => setName(field.target.value)}
              placeholder="Mercury Rev at the Lantern"
              className="w-full border-b border-ink bg-transparent pb-2 text-lg outline-none placeholder:text-rule focus:border-accent"
            />
          </Field>

          <Field label="Where">
            <input
              value={venue}
              onChange={(field) => setVenue(field.target.value)}
              placeholder="The Lantern, Bristol"
              className="w-full border-b border-ink bg-transparent pb-2 text-lg outline-none placeholder:text-rule focus:border-accent"
            />
          </Field>
        </section>

        <section>
          <div className="flex items-baseline justify-between gap-4">
            <h2 className="eyebrow text-muted">When</h2>
            <button
              type="button"
              onClick={suggestDates}
              className="eyebrow text-muted hover:text-accent"
            >
              Fill in a fortnight from now
            </button>
          </div>

          <div className="mt-4 grid gap-5 sm:grid-cols-2">
            <Field label="Doors open">
              <input
                type="datetime-local"
                value={doors}
                onChange={(field) => setDoors(field.target.value)}
                className="w-full border border-rule bg-card px-3 py-2.5 text-sm outline-none focus:border-ink"
              />
            </Field>
            <Field label="Resale closes">
              <input
                type="datetime-local"
                value={closes}
                onChange={(field) => setCloses(field.target.value)}
                className="w-full border border-rule bg-card px-3 py-2.5 text-sm outline-none focus:border-ink"
              />
            </Field>
          </div>
        </section>

        <section>
          <h2 className="eyebrow text-muted">Tickets</h2>

          <div className="mt-4 space-y-4">
            {tiers.map((tier, index) => (
              <div
                key={index}
                className="grid gap-4 border border-rule bg-card p-4 sm:grid-cols-[1fr_7rem_7rem_auto]"
              >
                <Field label="Called">
                  <input
                    value={tier.name}
                    onChange={(field) =>
                      updateTier(index, { name: field.target.value })
                    }
                    placeholder="General admission"
                    className="w-full border-b border-rule bg-transparent pb-1.5 text-sm outline-none placeholder:text-rule focus:border-ink"
                  />
                </Field>
                <Field label="Face value">
                  <input
                    value={tier.price}
                    onChange={(field) =>
                      updateTier(index, { price: field.target.value })
                    }
                    inputMode="decimal"
                    placeholder="18.50"
                    className="w-full border-b border-rule bg-transparent pb-1.5 text-sm outline-none placeholder:text-rule focus:border-ink"
                  />
                </Field>
                <Field label="Limit each">
                  <input
                    value={tier.limit}
                    onChange={(field) =>
                      updateTier(index, { limit: field.target.value })
                    }
                    inputMode="numeric"
                    className="w-full border-b border-rule bg-transparent pb-1.5 text-sm outline-none focus:border-ink"
                  />
                </Field>
                {tiers.length > 1 && (
                  <button
                    type="button"
                    onClick={() =>
                      setTiers((current) =>
                        current.filter((_, position) => position !== index)
                      )
                    }
                    className="eyebrow self-end pb-1.5 text-muted hover:text-accent"
                  >
                    Remove
                  </button>
                )}
              </div>
            ))}
          </div>

          {tiers.length < 10 && (
            <button
              type="button"
              onClick={() => setTiers((current) => [...current, { ...BLANK }])}
              className="eyebrow mt-4 text-muted hover:text-accent"
            >
              + Another kind of ticket
            </button>
          )}

          <p className="mt-4 text-xs leading-relaxed text-muted">
            Leave the price empty if it&apos;s free. The limit counts tickets
            somebody holds plus anything they&apos;re queuing for.
          </p>
        </section>

        <div className="border-t border-rule pt-6">
          <button
            type="submit"
            disabled={pending || name.trim() === "" || venue.trim() === ""}
            className="eyebrow bg-accent px-8 py-3.5 text-paper transition hover:bg-ink disabled:opacity-40"
          >
            {pending ? "Putting it on" : "Put it on"}
          </button>
          {error && <p className="mt-4 text-sm text-accent">{error}</p>}
        </div>
      </form>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="eyebrow block pb-2 text-muted">{label}</span>
      {children}
    </label>
  );
}

function toLocalInput(date: Date): string {
  const pad = (value: number) => value.toString().padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(
    date.getDate()
  )}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function uniqueSlug(name: string, index: number, used: Set<string>): string {
  const base =
    name
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 20) || `TIER${index + 1}`;

  let candidate = base;
  let suffix = 2;
  while (used.has(candidate)) {
    candidate = `${base}-${suffix}`;
    suffix += 1;
  }
  used.add(candidate);
  return candidate;
}
