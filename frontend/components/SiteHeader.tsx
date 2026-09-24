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

const ADMIN_LINKS = [
  { href: "/", label: "Events" },
  { href: "/organize", label: "Admin" },
  { href: "/door", label: "The door" },
];

function linksFor(role: User["role"] | null) {
  if (role === "admin") {
    return ADMIN_LINKS;
  }
  return LINKS;
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
            {linksFor(user?.role ?? null).map((link) => (
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
          <div className="flex items-baseline gap-4">
            <span className="hidden text-xs text-muted sm:inline">
              {user.email}
            </span>
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
