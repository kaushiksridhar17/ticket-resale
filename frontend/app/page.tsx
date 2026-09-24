import { Suspense } from "react";
import { Events } from "@/components/Events";

export default function EventsPage() {
  return (
    <Suspense fallback={<p className="text-sm text-muted">Loading</p>}>
      <Events />
    </Suspense>
  );
}
