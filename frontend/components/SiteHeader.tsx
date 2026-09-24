"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { User } from "@/lib/types";

interface Props {
  user: User | null;
  loading: boolean;
  onSignOut: () => void;
}

function linksFor(user: User | null) {
  if (user?.role === "admin") {
    return [
      { href: "/", label: "Events" },
      { href: "/organize", label: "Admin" },
      { href: "/organize/listings", label: "Submitted" },
      { href: "/door", label: "The door" },
    ];
  }

  const links = [{ href: "/", label: "Events" }];
  if (user) {
    links.push({ href: "/tickets", label: "My tickets" });
  }
  if (user?.sells) {
    links.push({ href: "/sell", label: "Sell" });
  }
  return links;
}

function PersonIcon() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor" aria-hidden>
      <circle cx="12" cy="7.5" r="4.25" />
      <path d="M12 13.25c-4.28 0-7.75 2.9-7.75 6.48 0 .15.12.27.27.27h14.96c.15 0 .27-.12.27-.27 0-3.58-3.47-6.48-7.75-6.48Z" />
    </svg>
  );
}

export function SiteHeader({ user, loading, onSignOut }: Props) {
  const pathname = usePathname();

  return (
    <header className="border-b border-rule">
      <div className="mx-auto flex max-w-4xl items-center justify-between px-6 py-5">
        <div className="flex items-baseline gap-10">
          <Link href="/" className="font-display text-2xl leading-none">
            Face <span className="italic text-accent">Value</span>
          </Link>
          <nav className="flex gap-6">
            {linksFor(user).map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className={`eyebrow border-b-2 pb-0.5 transition ${
                  pathname === link.href
                    ? "border-accent text-ink"
                    : "border-transparent text-muted hover:text-ink"
                }`}
              >
                {link.label}
              </Link>
            ))}
          </nav>
        </div>

        {loading ? null : user ? (
          <div className="flex items-center gap-4">
            <Link
              href="/settings"
              aria-label="Settings"
              className={`flex items-center gap-2 transition ${
                pathname === "/settings"
                  ? "text-ink"
                  : "text-muted hover:text-ink"
              }`}
            >
              <PersonIcon />
              <span className="hidden text-xs sm:inline">{user.email}</span>
            </Link>
            <button onClick={onSignOut} className="eyebrow text-muted hover:text-ink">
              Sign out
            </button>
          </div>
        ) : (
          <Link
            href="/signin"
            className="eyebrow bg-ink px-4 py-2.5 text-paper transition hover:bg-accent"
          >
            Sign in
          </Link>
        )}
      </div>
    </header>
  );
}
