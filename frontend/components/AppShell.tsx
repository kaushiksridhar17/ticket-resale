"use client";

import { SiteHeader } from "./SiteHeader";
import { useSession } from "@/lib/session";

export function AppShell({ children }: { children: React.ReactNode }) {
  const { user, loading, logout } = useSession();

  return (
    <>
      <SiteHeader user={user} loading={loading} onSignOut={() => void logout()} />
      <main className="mx-auto w-full max-w-4xl flex-1 px-6 py-12">{children}</main>
      <footer className="border-t border-rule">
        <p className="mx-auto max-w-4xl px-6 py-8 text-xs leading-relaxed text-muted">
          Tickets go out in the order people joined the queue and are paid for
          at the door, at face value. Nothing changes hands in between, so there
          is nothing for anyone to make money on, including us.
        </p>
      </footer>
    </>
  );
}
