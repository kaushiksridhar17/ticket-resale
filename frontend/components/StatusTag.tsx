import type { ListingStatus } from "@/lib/types";

const LABELS: Record<ListingStatus, string> = {
  pending: "Waiting",
  approved: "Approved",
  rejected: "Turned down",
};

export function StatusTag({ status }: { status: ListingStatus }) {
  return (
    <span
      className={`eyebrow shrink-0 border px-2 py-1 ${
        status === "approved"
          ? "border-ink text-ink"
          : status === "rejected"
            ? "border-accent text-accent"
            : "border-rule text-muted"
      }`}
    >
      {LABELS[status]}
    </span>
  );
}
