"use client";

import { useState } from "react";
import Link from "next/link";
import { ApiError, changePassword, updateSettings } from "@/lib/api";
import { THEMES, applyTheme } from "@/lib/theme";
import { useSession } from "@/lib/session";
import { Field, Submit } from "./AuthFields";
import type { Theme, User } from "@/lib/types";

export function Settings() {
  const { user, loading, setUser } = useSession();

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
        to change your settings.
      </p>
    );
  }

  return (
    <div className="max-w-sm">
      <h1 className="font-display text-4xl leading-tight">Settings</h1>
      <p className="mt-3 text-sm text-muted">{user.email}</p>

      <Appearance user={user} onSaved={setUser} />
      {user.role === "member" && <WhatYouDo user={user} onSaved={setUser} />}
      <Password email={user.email} />
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-12 border-t border-rule pt-6">
      <h2 className="eyebrow text-muted">{title}</h2>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function Appearance({
  user,
  onSaved,
}: {
  user: User;
  onSaved: (user: User) => void;
}) {
  const [error, setError] = useState<string | null>(null);

  async function choose(theme: Theme) {
    applyTheme(theme);
    setError(null);
    try {
      const { user: updated } = await updateSettings({ theme });
      onSaved(updated);
    } catch (caught) {
      applyTheme(user.theme);
      setError(caught instanceof ApiError ? caught.message : "Could not save");
    }
  }

  return (
    <Section title="Appearance">
      <div className="flex gap-2">
        {THEMES.map((theme) => (
          <button
            key={theme.value}
            onClick={() => void choose(theme.value)}
            className={`eyebrow flex-1 border py-2.5 transition ${
              user.theme === theme.value
                ? "border-accent bg-accent text-paper"
                : "border-rule text-muted hover:border-ink hover:text-ink"
            }`}
          >
            {theme.label}
          </button>
        ))}
      </div>
      {error && <p className="mt-3 text-sm text-accent">{error}</p>}
    </Section>
  );
}

function WhatYouDo({
  user,
  onSaved,
}: {
  user: User;
  onSaved: (user: User) => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function toggle(change: { buys?: boolean; sells?: boolean }) {
    setSaving(true);
    setError(null);
    try {
      const { user: updated } = await updateSettings(change);
      onSaved(updated);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Could not save");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Section title="Buying and selling">
      <div className="border-t border-rule">
        <Switch
          label="Buy tickets"
          note="Claim tickets and join queues."
          on={user.buys}
          disabled={saving}
          onChange={(buys) => void toggle({ buys })}
        />
        <Switch
          label="Sell tickets"
          note="Put up a ticket you cannot use."
          on={user.sells}
          disabled={saving}
          onChange={(sells) => void toggle({ sells })}
        />
      </div>
      <p className="mt-3 text-xs leading-relaxed text-muted">
        A ticket you already hold can always be passed on, whichever of these
        is on.
      </p>
      {error && <p className="mt-3 text-sm text-accent">{error}</p>}
    </Section>
  );
}

function Switch({
  label,
  note,
  on,
  disabled,
  onChange,
}: {
  label: string;
  note: string;
  on: boolean;
  disabled: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-baseline gap-3 border-b border-rule py-4">
      <input
        type="checkbox"
        checked={on}
        disabled={disabled}
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

function Password({ email }: { email: string }) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [saving, setSaving] = useState(false);

  const mismatch = confirm.length > 0 && next !== confirm;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (mismatch) {
      return;
    }

    setSaving(true);
    setError(null);
    setDone(false);

    try {
      await changePassword(current, next);
      setCurrent("");
      setNext("");
      setConfirm("");
      setDone(true);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Could not save");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Section title="Password">
      <form onSubmit={submit} className="space-y-5">
        <input
          type="text"
          name="username"
          autoComplete="username"
          value={email}
          readOnly
          hidden
        />
        <Field
          label="Current password"
          value={current}
          onChange={setCurrent}
          type="password"
          autoComplete="current-password"
          placeholder=""
        />
        <Field
          label="New password"
          value={next}
          onChange={setNext}
          type="password"
          autoComplete="new-password"
          placeholder="At least eight characters"
        />
        <Field
          label="New password again"
          value={confirm}
          onChange={setConfirm}
          type="password"
          autoComplete="new-password"
          placeholder=""
        />
        <Submit
          pending={saving}
          disabled={
            saving || current.length < 1 || next.length < 1 || mismatch
          }
        >
          Change password
        </Submit>
      </form>

      {mismatch && (
        <p className="mt-3 text-sm text-accent">Those two do not match.</p>
      )}
      {error && <p className="mt-3 text-sm text-accent">{error}</p>}
      {done && (
        <p className="mt-3 text-sm">
          Changed. Any other browser signed in as you has been signed out.
        </p>
      )}
    </Section>
  );
}
