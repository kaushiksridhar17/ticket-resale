"use client";

import { useState } from "react";
import { ApiError, requestSignInCode, verifySignInCode } from "@/lib/api";
import type { User } from "@/lib/types";

interface Props {
  onSignedIn: (user: User) => void;
}

export function SignIn({ onSignedIn }: Props) {
  const [stage, setStage] = useState<"email" | "code">("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function sendCode(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);

    try {
      await requestSignInCode(email);
      setStage("code");
    } catch (caught) {
      setError(
        caught instanceof ApiError ? caught.message : "Could not reach the server"
      );
    } finally {
      setPending(false);
    }
  }

  async function submitCode(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);

    try {
      const { user } = await verifySignInCode(email, code.trim());
      onSignedIn(user);
    } catch (caught) {
      setError(
        caught instanceof ApiError ? caught.message : "Could not reach the server"
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="max-w-sm">
      <h1 className="font-display text-4xl leading-tight">
        {stage === "email" ? "Who is this?" : "Check your email"}
      </h1>
      <p className="mt-3 text-sm leading-relaxed text-muted">
        {stage === "email"
          ? "No password. We send a six digit code and that is the whole of it."
          : `We sent six digits to ${email}.`}
      </p>

      {stage === "email" ? (
        <form onSubmit={sendCode} className="mt-8 space-y-4">
          <input
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            type="email"
            autoComplete="email"
            placeholder="you@example.com"
            className="w-full border-b border-ink bg-transparent pb-2 text-lg outline-none placeholder:text-rule focus:border-accent"
          />
          <button
            type="submit"
            disabled={pending || email.length < 3}
            className="eyebrow w-full bg-accent py-3.5 text-paper transition hover:bg-ink disabled:opacity-40"
          >
            {pending ? "Sending" : "Send the code"}
          </button>
        </form>
      ) : (
        <form onSubmit={submitCode} className="mt-8 space-y-4">
          <input
            value={code}
            onChange={(event) => setCode(event.target.value)}
            inputMode="numeric"
            maxLength={6}
            placeholder="000000"
            className="w-full border-b border-ink bg-transparent pb-2 text-center font-display text-4xl tracking-[0.3em] outline-none placeholder:text-rule focus:border-accent"
          />
          <button
            type="submit"
            disabled={pending || code.trim().length !== 6}
            className="eyebrow w-full bg-accent py-3.5 text-paper transition hover:bg-ink disabled:opacity-40"
          >
            {pending ? "Checking" : "Let me in"}
          </button>
          <button
            type="button"
            onClick={() => {
              setStage("email");
              setCode("");
              setError(null);
            }}
            className="eyebrow w-full text-muted hover:text-ink"
          >
            Use a different address
          </button>
        </form>
      )}

      {error && <p className="mt-4 text-sm text-accent">{error}</p>}

      <p className="mt-10 border-t border-rule pt-4 text-xs leading-relaxed text-muted">
        While this is running on your own machine the code is printed in the
        engine terminal instead of emailed.
      </p>
    </div>
  );
}
