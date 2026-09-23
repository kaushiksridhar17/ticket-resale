"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { User } from "@/lib/types";

interface Props {
  user: User | null;
  loading: boolean;
  onSignOut: () => void;
}

const LINKS = [
  { href: "/", label: "Events" },
  { href: "/tickets", label: "My tickets" },
];

export function SiteHeader({ user, loading, onSignOut }: Props) {
  const pathname = usePathname();

  return (
    <header className="border-b border-slate-800 bg-slate-950">
      <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
        <div className="flex items-center gap-8">
          <Link href="/" className="text-sm font-semibold tracking-tight">
            Face Value
          </Link>
          <nav className="flex gap-5 text-sm">
            {LINKS.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className={
                  pathname === link.href
                    ? "text-slate-100"
                    : "text-slate-500 hover:text-slate-300"
                }
              >
                {link.label}
              </Link>
            ))}
          </nav>
        </div>

        {loading ? null : user ? (
          <div className="flex items-center gap-3 text-xs text-slate-500">
            <span className="hidden sm:inline">{user.email}</span>
            <button
              onClick={onSignOut}
              className="text-slate-500 underline hover:text-slate-300"
            >
              sign out
            </button>
          </div>
        ) : (
          <Link
            href="/signin"
            className="rounded bg-slate-100 px-3 py-1.5 text-xs font-medium text-slate-900"
          >
            Sign in
          </Link>
        )}
      </div>
    </header>
  );
}
