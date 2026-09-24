"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ApiError, register } from "@/lib/api";
import { homeFor } from "@/lib/roles";
import { useSession } from "@/lib/session";
import { Field, Submit } from "./AuthFields";

export function RegisterForm() {
  const router = useRouter();
  const { user, setUser } = useSession();

  const [buys, setBuys] = useState(true);
  const [sells, setSells] = useState(false);
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  if (user) {
    return (
      <p className="text-sm text-muted">You are signed in as {user.email}.</p>
    );
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);

    try {
      const { user: created } = await register({
        email: email.trim(),
        password,
        buys,
        sells,
        ...(displayName.trim() ? { displayName: displayName.trim() } : {}),
      });
      setUser(created);
      router.push(homeFor(created.role));
    } catch (caught) {
      setError(
        caught instanceof ApiError ? caught.message : "Could not reach the server"
      );
      setPending(false);
    }
  }

  return (
    <div className="max-w-sm">
      <h1 className="font-display text-4xl leading-tight">Create an account</h1>

      <form onSubmit={submit} className="mt-8 space-y-6">
        <fieldset>
          <legend className="eyebrow text-muted">
            What do you want to do here?
          </legend>
          <div className="mt-2 border-t border-rule">
            <Tick
              label="Buy tickets"
              note="Claim tickets at face value, or wait in line."
              on={buys}
              onChange={setBuys}
            />
            <Tick
              label="Sell tickets"
              note="Put up a ticket you cannot use."
              on={sells}
              onChange={setSells}
            />
          </div>
          <p className="mt-2 text-xs text-muted">
            Either, or both. You can change this later.
          </p>
        </fieldset>

        <Field
          label="Name"
          value={displayName}
          onChange={setDisplayName}
          type="text"
          autoComplete="name"
          placeholder="Optional"
        />
        <Field
          label="Email"
          value={email}
          onChange={setEmail}
          type="email"
          autoComplete="email"
          placeholder="you@example.com"
        />
        <Field
          label="Password"
          value={password}
          onChange={setPassword}
          type="password"
          autoComplete="new-password"
          placeholder="At least eight characters"
        />

        <Submit
          pending={pending}
          disabled={
            pending ||
            (!buys && !sells) ||
            email.length < 3 ||
            password.length < 1
          }
        >
          Create account
        </Submit>
      </form>

      {error && <p className="mt-4 text-sm text-accent">{error}</p>}

      <p className="mt-10 border-t border-rule pt-4 text-xs text-muted">
        Already have one?{" "}
        <Link
          href="/signin"
          className="text-ink underline decoration-accent underline-offset-4"
        >
          Sign in
        </Link>
        .
      </p>
    </div>
  );
}

function Tick({
  label,
  note,
  on,
  onChange,
}: {
  label: string;
  note: string;
  on: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-baseline gap-3 border-b border-rule py-4">
      <input
        type="checkbox"
        checked={on}
        onChange={(event) => onChange(event.target.checked)}
        className="sr-only"
      />
      <span
        aria-hidden
        className={`mt-1 h-2.5 w-2.5 shrink-0 border transition ${
          on ? "border-accent bg-accent" : "border-rule bg-transparent"
        }`}
      />
      <span>
        <span className={`block text-sm ${on ? "text-ink" : "text-muted"}`}>
          {label}
        </span>
        <span className="mt-0.5 block text-xs text-muted">{note}</span>
      </span>
    </label>
  );
}
