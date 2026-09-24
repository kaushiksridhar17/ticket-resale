"use client";

import { useEffect, useRef, useState } from "react";
import { ApiError, fetchEvents, submitListing } from "@/lib/api";
import { formatDate, formatPrice } from "@/lib/format";
import type { EventSummary } from "@/lib/types";

interface Props {
  onSubmitted: () => void;
}

export function SellForm({ onSubmitted }: Props) {
  const [events, setEvents] = useState<EventSummary[] | null>(null);
  const [eventId, setEventId] = useState("");
  const [tierId, setTierId] = useState("");
  const [quantity, setQuantity] = useState(1);
  const [note, setNote] = useState("");
  const [photo, setPhoto] = useState<File | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;
    fetchEvents()
      .then((result) => {
        if (cancelled) {
          return;
        }
        const open = result.events.filter((event) => event.resaleOpen);
        setEvents(open);
        if (open[0]) {
          setEventId(open[0].id);
          setTierId(open[0].tiers[0]?.tierId ?? "");
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
  }, []);

  const event = events?.find((entry) => entry.id === eventId) ?? null;
  const tier = event?.tiers.find((entry) => entry.tierId === tierId) ?? null;

  async function submit(formEvent: React.FormEvent) {
    formEvent.preventDefault();
    if (!photo || !event || !tier) {
      return;
    }

    setPending(true);
    setError(null);

    const form = new FormData();
    form.set("eventId", event.id);
    form.set("tierId", tier.tierId);
    form.set("quantity", String(quantity));
    if (note.trim()) {
      form.set("note", note.trim());
    }
    form.set("photo", photo);

    try {
      await submitListing(form);
      setPhoto(null);
      setNote("");
      setQuantity(1);
      if (fileInput.current) {
        fileInput.current.value = "";
      }
      onSubmitted();
    } catch (caught) {
      setError(
        caught instanceof ApiError ? caught.message : "Could not reach the server"
      );
    } finally {
      setPending(false);
    }
  }

  if (events === null) {
    return <p className="text-sm text-muted">Loading</p>;
  }

  if (events.length === 0) {
    return (
      <p className="text-sm text-muted">Nothing is taking tickets right now.</p>
    );
  }

  return (
    <form onSubmit={submit} className="max-w-sm space-y-5">
      <label className="block">
        <span className="eyebrow text-muted">Event</span>
        <select
          value={eventId}
          onChange={(field) => {
            const next = events.find((entry) => entry.id === field.target.value);
            setEventId(field.target.value);
            setTierId(next?.tiers[0]?.tierId ?? "");
          }}
          className="mt-1.5 w-full border border-rule bg-card px-3 py-2.5 text-sm text-ink outline-none focus:border-ink"
        >
          {events.map((entry) => (
            <option key={entry.id} value={entry.id}>
              {entry.name} · {formatDate(entry.startsAt)}
            </option>
          ))}
        </select>
      </label>

      <label className="block">
        <span className="eyebrow text-muted">Tier</span>
        <select
          value={tierId}
          onChange={(field) => setTierId(field.target.value)}
          className="mt-1.5 w-full border border-rule bg-card px-3 py-2.5 text-sm text-ink outline-none focus:border-ink"
        >
          {(event?.tiers ?? []).map((entry) => (
            <option key={entry.tierId} value={entry.tierId}>
              {entry.name} · {formatPrice(entry.faceValueInCents)}
            </option>
          ))}
        </select>
      </label>

      <label className="block">
        <span className="eyebrow text-muted">How many</span>
        <select
          value={quantity}
          onChange={(field) => setQuantity(Number(field.target.value))}
          className="mt-1.5 w-24 border border-rule bg-card px-3 py-2.5 text-sm text-ink outline-none focus:border-ink"
        >
          {Array.from(
            { length: Math.max(1, tier?.perPersonLimit ?? 1) },
            (_, index) => index + 1
          ).map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      </label>

      <label className="block">
        <span className="eyebrow text-muted">Photo of the ticket</span>
        <input
          ref={fileInput}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          onChange={(field) => setPhoto(field.target.files?.[0] ?? null)}
          className="mt-1.5 block w-full text-sm text-muted file:mr-3 file:border file:border-rule file:bg-card file:px-3 file:py-2 file:text-xs file:uppercase file:tracking-widest file:text-ink"
        />
      </label>

      <label className="block">
        <span className="eyebrow text-muted">Note</span>
        <input
          value={note}
          onChange={(field) => setNote(field.target.value)}
          maxLength={300}
          placeholder="Optional"
          className="mt-1.5 w-full border-b border-ink bg-transparent pb-2 text-sm outline-none placeholder:text-rule focus:border-accent"
        />
      </label>

      {tier && (
        <p className="text-xs text-muted">
          It will sell for {formatPrice(tier.faceValueInCents)}, the face value
          on the event.
        </p>
      )}

      <button
        type="submit"
        disabled={pending || !photo || !tier}
        className="eyebrow w-full bg-accent py-3.5 text-paper transition hover:bg-ink disabled:opacity-40"
      >
        {pending ? "Sending" : "Submit for checking"}
      </button>

      {error && <p className="text-sm text-accent">{error}</p>}
    </form>
  );
}
