"use client";

import Link from "next/link";
import { useSession } from "@/lib/session";

interface Door {
  href: string;
  label: string;
  blurb: string;
}

interface Props {
  heading: string;
  blurb: string;
  doors: Door[];
  footer: React.ReactNode;
}

export function RolePicker({ heading, blurb, doors, footer }: Props) {
  const { user } = useSession();

  if (user) {
    return (
      <p className="text-sm text-muted">You are signed in as {user.email}.</p>
    );
  }

  return (
    <div className="max-w-sm">
      <h1 className="font-display text-4xl leading-tight">{heading}</h1>
      <p className="mt-3 text-sm leading-relaxed text-muted">{blurb}</p>

      <ul className="mt-8 border-t border-rule">
        {doors.map((door) => (
          <li key={door.href}>
            <Link
              href={door.href}
              className="group flex items-baseline justify-between gap-6 border-b border-rule py-5 transition"
            >
              <span>
                <span className="font-display text-2xl leading-none transition group-hover:text-accent">
                  {door.label}
                </span>
                <span className="mt-1.5 block text-sm leading-relaxed text-muted">
                  {door.blurb}
                </span>
              </span>
              <span className="eyebrow text-muted transition group-hover:text-accent">
                Go
              </span>
            </Link>
          </li>
        ))}
      </ul>

      <p className="mt-10 text-xs leading-relaxed text-muted">{footer}</p>
    </div>
  );
}
