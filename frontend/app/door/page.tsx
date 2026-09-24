"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ApiError, fetchEvents, scanPass } from "@/lib/api";
import { formatDate, formatPrice } from "@/lib/format";
import { useSession } from "@/lib/session";
import type { EventSummary, ScanResult } from "@/lib/types";

interface Detector {
  detect(source: CanvasImageSource): Promise<{ rawValue: string }[]>;
}

interface DetectorConstructor {
  new (options: { formats: string[] }): Detector;
}

function detectorFor(): Detector | null {
  const available = (globalThis as { BarcodeDetector?: DetectorConstructor })
    .BarcodeDetector;
  return available ? new available({ formats: ["qr_code"] }) : null;
}

export default function DoorPage() {
  const { user, loading } = useSession();
  const [events, setEvents] = useState<EventSummary[]>([]);
  const [eventId, setEventId] = useState("");
  const [result, setResult] = useState<ScanResult | null>(null);
  const [manual, setManual] = useState("");
  const [scanning, setScanning] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);

  const video = useRef<HTMLVideoElement | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const lastToken = useRef<string>("");

  useEffect(() => {
    if (!user) {
      return;
    }
    let cancelled = false;
    fetchEvents()
      .then((response) => {
        if (!cancelled) {
          setEvents(response.events);
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [user]);

  const submit = useCallback(
    async (token: string) => {
      try {
        setResult(await scanPass(token.trim(), eventId));
      } catch (caught) {
        setResult({
          admitted: false,
          reason: "error",
          message:
            caught instanceof ApiError
              ? caught.message
              : "Couldn\u2019t reach the door",
        });
      }
    },
    [eventId]
  );

  useEffect(() => {
    if (!scanning || eventId === "") {
      return;
    }

    const detector = detectorFor();
    if (!detector) {
      return;
    }

    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | null = null;

    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: "environment" } })
      .then((media) => {
        if (cancelled) {
          media.getTracks().forEach((track) => track.stop());
          return;
        }
        stream.current = media;
        if (video.current) {
          video.current.srcObject = media;
          void video.current.play();
        }

        timer = setInterval(async () => {
          if (!video.current || video.current.readyState < 2) {
            return;
          }
          try {
            const found = await detector.detect(video.current);
            const token = found[0]?.rawValue;
            if (token && token !== lastToken.current) {
              lastToken.current = token;
              await submit(token);
            }
          } catch {
            return;
          }
        }, 400);
      })
      .catch(() => {
        if (!cancelled) {
          setCameraError("No camera here. Type it in instead.");
          setScanning(false);
        }
      });

    return () => {
      cancelled = true;
      if (timer) {
        clearInterval(timer);
      }
      stream.current?.getTracks().forEach((track) => track.stop());
      stream.current = null;
    };
  }, [scanning, eventId, submit]);

  if (loading) {
    return <p className="text-sm text-muted">Loading</p>;
  }

  if (!user || user.role !== "admin") {
    return (
      <div className="max-w-lg">
        <h1 className="font-display text-4xl leading-tight">The door</h1>
        <p className="mt-4 text-sm text-muted">
          You do not have access to this page.
        </p>
      </div>
    );
  }

  const selected = events.find((event) => event.id === eventId);

  return (
    <div className="max-w-xl">
      <h1 className="font-display text-4xl leading-tight">The door</h1>

      <label className="mt-8 block">
        <span className="eyebrow block pb-2 text-muted">Tonight</span>
        <select
          value={eventId}
          onChange={(field) => {
            setEventId(field.target.value);
            setResult(null);
            setScanning(false);
          }}
          className="w-full border border-rule bg-card px-3 py-3 text-sm outline-none focus:border-ink"
        >
          <option value="">Pick an event</option>
          {events.map((event) => (
            <option key={event.id} value={event.id}>
              {event.name} · {formatDate(event.startsAt)}
            </option>
          ))}
        </select>
      </label>

      {selected && (
        <>
          {result && <Verdict result={result} />}

          <div className="mt-8">
            {scanning ? (
              <div>
                <video
                  ref={video}
                  muted
                  playsInline
                  className="w-full border border-ink bg-ink"
                />
                <button
                  onClick={() => setScanning(false)}
                  className="eyebrow mt-3 w-full border border-ink py-3 transition hover:bg-ink hover:text-paper"
                >
                  Stop the camera
                </button>
              </div>
            ) : (
              <button
                onClick={() => {
                  if (!detectorFor()) {
                    setCameraError(
                      "This browser can\u2019t read QR codes. Type it in instead."
                    );
                    return;
                  }
                  setCameraError(null);
                  lastToken.current = "";
                  setScanning(true);
                }}
                className="eyebrow w-full bg-accent py-4 text-paper transition hover:bg-ink"
              >
                Start scanning
              </button>
            )}
            {cameraError && (
              <p className="mt-3 text-xs text-muted">{cameraError}</p>
            )}
          </div>

          <form
            onSubmit={(formEvent) => {
              formEvent.preventDefault();
              void submit(manual);
              setManual("");
            }}
            className="mt-10 border-t border-rule pt-6"
          >
            <label className="block">
              <span className="eyebrow block pb-2 text-muted">
Type it instead
              </span>
              <input
                value={manual}
                onChange={(field) => setManual(field.target.value)}
                placeholder="tkt_41.1.56666666.…"
                className="w-full border border-rule bg-card px-3 py-3 font-mono text-xs outline-none placeholder:text-rule focus:border-ink"
              />
            </label>
            <button
              type="submit"
              disabled={manual.trim() === ""}
              className="eyebrow mt-3 w-full border border-ink py-3 transition hover:bg-ink hover:text-paper disabled:opacity-40"
            >
              Check it
            </button>
          </form>
        </>
      )}

      <p className="mt-10 text-xs text-muted">
        Passes last thirty seconds.{" "}
        <Link href="/admin" className="underline underline-offset-4">
          Admin
        </Link>{" "}
        show who holds what.
      </p>
    </div>
  );
}

function Verdict({ result }: { result: ScanResult }) {
  if (result.admitted) {
    return (
      <div className="mt-8 border-2 border-ink bg-ink px-6 py-8 text-paper">
        <p className="font-display text-5xl leading-none">Let them in</p>
        <p className="eyebrow mt-4">
          No. {result.serial}
          {result.tierName ? ` · ${result.tierName}` : ""}
        </p>
        {result.owedInCents !== null && result.owedInCents > 0 && (
          <p className="mt-4 font-display text-3xl leading-none">
            Collect {formatPrice(result.owedInCents)}
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="mt-8 border-2 border-accent bg-accent-soft px-6 py-8">
      <p className="font-display text-4xl leading-tight text-accent">
        {result.message}
      </p>
      {result.serial !== undefined && (
        <p className="eyebrow mt-4 text-muted">No. {result.serial}</p>
      )}
    </div>
  );
}
