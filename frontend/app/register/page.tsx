import Link from "next/link";
import { RolePicker } from "@/components/RolePicker";

export default function RegisterPage() {
  return (
    <RolePicker
      heading="What brings you here?"
      blurb="Pick one. An account buys or sells, and the choice is made once."
      doors={[
        {
          href: "/register/customer",
          label: "I want a ticket",
          blurb: "Claim one at face value, or wait in line for one.",
        },
        {
          href: "/register/seller",
          label: "I have a spare",
          blurb: "Put a ticket up for somebody else, at what you paid.",
        },
      ]}
      footer={
        <>
          The account that runs the site is not made here. Already have an
          account?{" "}
          <Link
            href="/signin"
            className="text-ink underline decoration-accent underline-offset-4"
          >
            Sign in
          </Link>
          .
        </>
      }
    />
  );
}
