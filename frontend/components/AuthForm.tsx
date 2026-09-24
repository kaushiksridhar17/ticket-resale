"use client";

import { useState } from "react";
import Link from "next/link";
import { ApiError, logIn, register } from "@/lib/api";
import { ROLE_COPY } from "@/lib/roles";
import type { Role, User } from "@/lib/types";

interface Props {
  role: Role;
  mode: "signin" | "register";
  onSignedIn: (user: User) => void;
}

export function AuthForm({ role, mode, onSignedIn }: Props) {
  const copy = ROLE_COPY[role];
  const registering = mode === "register";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);

    try {
      const result =
        registering && role !== "admin"
          ? await register({
              email: email.trim(),
              password,
              role,
              ...(displayName.trim() ? { displayName: displayName.trim() } : {}),
            })
          : await logIn({ email: email.trim(), password, role });
      onSignedIn(result.user);
    } catch (caught) {
      setError(
        caught instanceof ApiError ? caught.message : "Could not reach the server"
      );
      setPending(false);
    }
  }

  return (
    <div className="max-w-sm">
      <p className="eyebrow text-accent">{copy.noun}</p>
      <h1 className="mt-2 font-display text-4xl leading-tight">
        {registering ? copy.registerHeading : copy.signInHeading}
      </h1>
      <p className="mt-3 text-sm leading-relaxed text-muted">
        {registering ? copy.registerBlurb : copy.signInBlurb}
      </p>

      <form onSubmit={submit} className="mt-8 space-y-5">
        {registering && (
          <Field
            label="Name"
            value={displayName}
            onChange={setDisplayName}
            type="text"
            autoComplete="name"
            placeholder="Optional"
          />
        )}
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
          autoComplete={registering ? "new-password" : "current-password"}
          placeholder={registering ? "At least eight characters" : ""}
        />

        <button
          type="submit"
          disabled={pending || email.length < 3 || password.length < 1}
          className="eyebrow w-full bg-accent py-3.5 text-paper transition hover:bg-ink disabled:opacity-40"
        >
          {pending
            ? registering
              ? "Creating"
              : "Checking"
            : registering
              ? "Create the account"
              : "Sign in"}
        </button>
      </form>

      {error && <p className="mt-4 text-sm text-accent">{error}</p>}

      {copy.canRegister && (
        <p className="mt-10 border-t border-rule pt-4 text-xs leading-relaxed text-muted">
          {registering ? (
            <>
              Already have one?{" "}
              <Link
                href={`/signin/${role}`}
                className="text-ink underline decoration-accent underline-offset-4"
              >
                Sign in instead
              </Link>
              .
            </>
          ) : (
            <>
              No account yet?{" "}
              <Link
                href={`/register/${role}`}
                className="text-ink underline decoration-accent underline-offset-4"
              >
                Create one
              </Link>
              . One account is either a customer or a seller, never both.
            </>
          )}
        </p>
      )}
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  type,
  autoComplete,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (next: string) => void;
  type: string;
  autoComplete: string;
  placeholder: string;
}) {
  return (
    <label className="block">
      <span className="eyebrow text-muted">{label}</span>
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        type={type}
        autoComplete={autoComplete}
        placeholder={placeholder}
        className="mt-1.5 w-full border-b border-ink bg-transparent pb-2 text-lg outline-none placeholder:text-rule focus:border-accent"
      />
    </label>
  );
}
