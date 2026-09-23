"use client";

import { SiteHeader } from "./SiteHeader";
import { useSession } from "@/lib/session";

export function AppShell({ children }: { children: React.ReactNode }) {
  const { user, loading, logout } = useSession();

  return (
    <>
      <SiteHeader user={user} loading={loading} onSignOut={() => void logout()} />
      <main className="mx-auto w-full max-w-5xl flex-1 px-6 py-8">{children}</main>
      <footer className="border-t border-slate-800 px-6 py-6 text-center text-xs text-slate-600">
        Tickets change hands at face value or less. Nobody profits from resale.
      </footer>
    </>
  );
}
