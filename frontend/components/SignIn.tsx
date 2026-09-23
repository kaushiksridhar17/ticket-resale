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
    <div className="mx-auto mt-24 w-full max-w-sm rounded-lg border border-slate-800 bg-slate-900/40 p-6">
      <h1 className="mb-1 text-lg font-semibold">Sign in</h1>
      <p className="mb-6 text-xs text-slate-500">
        {stage === "email"
          ? "We will email you a six digit code."
          : `Enter the code sent to ${email}.`}
      </p>

      {stage === "email" ? (
        <form onSubmit={sendCode} className="space-y-3">
          <input
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            type="email"
            autoComplete="email"
            placeholder="you@example.com"
            className="w-full rounded border border-slate-800 bg-slate-950 px-3 py-2 text-sm outline-none focus:border-slate-600"
          />
          <button
            type="submit"
            disabled={pending || email.length < 3}
            className="w-full rounded bg-slate-100 py-2 text-sm font-medium text-slate-900 disabled:opacity-40"
          >
            {pending ? "Sending" : "Send code"}
          </button>
        </form>
      ) : (
        <form onSubmit={submitCode} className="space-y-3">
          <input
            value={code}
            onChange={(event) => setCode(event.target.value)}
            inputMode="numeric"
            maxLength={6}
            placeholder="000000"
            className="w-full rounded border border-slate-800 bg-slate-950 px-3 py-2 text-center font-mono text-lg tracking-widest outline-none focus:border-slate-600"
          />
          <button
            type="submit"
            disabled={pending || code.trim().length !== 6}
            className="w-full rounded bg-slate-100 py-2 text-sm font-medium text-slate-900 disabled:opacity-40"
          >
            {pending ? "Checking" : "Sign in"}
          </button>
          <button
            type="button"
            onClick={() => {
              setStage("email");
              setCode("");
              setError(null);
            }}
            className="w-full text-xs text-slate-500 hover:text-slate-300"
          >
            Use a different address
          </button>
        </form>
      )}

      {error && <p className="mt-3 text-xs text-rose-400">{error}</p>}

      <p className="mt-6 text-[11px] leading-relaxed text-slate-600">
        In development the code is printed in the engine terminal rather than
        emailed.
      </p>
    </div>
  );
}
