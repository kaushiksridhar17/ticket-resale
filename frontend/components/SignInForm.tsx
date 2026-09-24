"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ApiError, logIn } from "@/lib/api";
import { homeFor } from "@/lib/roles";
import { useSession } from "@/lib/session";
import { Field, Submit } from "./AuthFields";

export function SignInForm() {
  const router = useRouter();
  const { user, setUser } = useSession();

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
      const { user: signedIn } = await logIn({
        email: email.trim(),
        password,
      });
      setUser(signedIn);
      router.push(homeFor(signedIn.role));
    } catch (caught) {
      setError(
        caught instanceof ApiError ? caught.message : "Could not reach the server"
      );
      setPending(false);
    }
  }

  return (
    <div className="max-w-sm">
      <h1 className="font-display text-4xl leading-tight">Sign in</h1>

      <form onSubmit={submit} className="mt-8 space-y-5">
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
          autoComplete="current-password"
          placeholder=""
        />
        <Submit
          pending={pending}
          disabled={pending || email.length < 3 || password.length < 1}
        >
          Sign in
        </Submit>
      </form>

      {error && <p className="mt-4 text-sm text-accent">{error}</p>}

      <p className="mt-10 border-t border-rule pt-4 text-xs text-muted">
        No account yet?{" "}
        <Link
          href="/register"
          className="text-ink underline decoration-accent underline-offset-4"
        >
          Create one
        </Link>
        .
      </p>
    </div>
  );
}
