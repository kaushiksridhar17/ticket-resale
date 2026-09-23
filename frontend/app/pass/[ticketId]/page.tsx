"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import QRCode from "qrcode";
import { ApiError, fetchPass } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import { useSession } from "@/lib/session";
import type { TicketPass } from "@/lib/types";

const REFRESH_MS = 20_000;

export default function PassPage() {
  const params = useParams();
  const ticketId = String(params.ticketId ?? "");
  const { user, loading } = useSession();

  const [pass, setPass] = useState<TicketPass | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const canvas = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    if (!user) {
      return;
    }

    let cancelled = false;

    const load = () =>
      fetchPass(ticketId)
        .then((result) => {
          if (!cancelled) {
            setPass(result);
            setError(null);
            setCopied(false);
          }
        })
        .catch((caught: unknown) => {
          if (!cancelled) {
            setError(
              caught instanceof ApiError && caught.status === 409
                ? "This event has been called off."
                : "That ticket isn\u2019t yours."
            );
          }
        });

    void load();
    const timer = setInterval(() => void load(), REFRESH_MS);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [ticketId, user]);

  useEffect(() => {
    if (!pass || !canvas.current) {
      return;
    }
    void QRCode.toCanvas(canvas.current, pass.token, {
      width: 320,
      margin: 1,
      color: { dark: "#191510", light: "#ffffff" },
    });
  }, [pass]);

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
        to show your ticket.
      </p>
    );
  }

  if (error) {
    return (
      <div>
        <p className="font-display text-2xl">{error}</p>
        <Link href="/tickets" className="eyebrow mt-4 inline-block text-muted">
          ← Your tickets
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-sm text-center">
      <Link href="/tickets" className="eyebrow text-muted hover:text-ink">
        ← Your tickets
      </Link>

      {pass?.admittedAt ? (
        <div className="mt-10 border border-rule bg-card p-8">
          <p className="font-display text-3xl leading-tight">Already used</p>
          <p className="eyebrow mt-3 text-muted">
            Scanned in at {formatDateTime(pass.admittedAt)}
          </p>
        </div>
      ) : (
        <>
          <p className="eyebrow mt-10 text-muted">Ticket</p>
          <p className="font-display text-5xl leading-none">
            No. {pass?.serial ?? "—"}
          </p>

          <div className="mt-8 inline-block border border-rule bg-white p-4">
            <canvas ref={canvas} className="block h-[320px] w-[320px]" />
          </div>

          {pass && (
            <div className="mt-6">
              <p className="eyebrow text-muted">If the scanner won&apos;t play</p>
              <p className="mt-2 break-all font-mono text-[11px] leading-relaxed text-muted">
                {pass.token}
              </p>
              <button
                onClick={() => {
                  void navigator.clipboard
                    .writeText(pass.token)
                    .then(() => setCopied(true))
                    .catch(() => undefined);
                }}
                className="eyebrow mt-2 text-muted hover:text-accent"
              >
                {copied ? "Copied" : "Copy the code"}
              </button>
            </div>
          )}

          <p className="mt-8 text-xs leading-relaxed text-muted">
            New code every half minute. Passing the ticket on kills the old
            one, so a screenshot is no use to anyone.
          </p>
        </>
      )}
    </div>
  );
}
