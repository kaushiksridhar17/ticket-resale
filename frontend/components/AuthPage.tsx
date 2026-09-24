"use client";

import { useRouter } from "next/navigation";
import { AuthForm } from "./AuthForm";
import { homeFor } from "@/lib/roles";
import { useSession } from "@/lib/session";
import type { Role } from "@/lib/types";

interface Props {
  role: Role;
  mode: "signin" | "register";
}

export function AuthPage({ role, mode }: Props) {
  const router = useRouter();
  const { user, setUser } = useSession();

  if (user) {
    return (
      <p className="text-sm text-muted">
        You are signed in as {user.email}, {article(user.role)} {user.role}.
      </p>
    );
  }

  return (
    <AuthForm
      role={role}
      mode={mode}
      onSignedIn={(signedIn) => {
        setUser(signedIn);
        router.push(homeFor(signedIn.role));
      }}
    />
  );
}

function article(role: Role): string {
  return role === "admin" ? "an" : "a";
}
