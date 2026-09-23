"use client";

import { useRouter } from "next/navigation";
import { SignIn } from "@/components/SignIn";
import { useSession } from "@/lib/session";

export default function SignInPage() {
  const router = useRouter();
  const { user, setUser } = useSession();

  if (user) {
    return (
      <p className="text-sm text-slate-400">
        You are signed in as {user.email}.
      </p>
    );
  }

  return (
    <SignIn
      onSignedIn={(signedIn) => {
        setUser(signedIn);
        router.push("/");
      }}
    />
  );
}
