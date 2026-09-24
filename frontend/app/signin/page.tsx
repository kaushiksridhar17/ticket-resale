import Link from "next/link";
import { RolePicker } from "@/components/RolePicker";

export default function SignInPage() {
  return (
    <RolePicker
      heading="Which door?"
      blurb="Every account is one thing only, so the entrance depends on what you came to do."
      doors={[
        {
          href: "/signin/customer",
          label: "I am buying",
          blurb: "Claim a ticket, or hold a place until one comes free.",
        },
        {
          href: "/signin/seller",
          label: "I am selling",
          blurb: "Submit a ticket you cannot use and watch for the approval.",
        },
        {
          href: "/signin/admin",
          label: "I run this",
          blurb: "Events, approvals, and the door.",
        },
      ]}
      footer={
        <>
          No account yet?{" "}
          <Link
            href="/register"
            className="text-ink underline decoration-accent underline-offset-4"
          >
            Create one
          </Link>
          .
        </>
      }
    />
  );
}
