export type ListingStatus = "pending" | "approved" | "rejected";

export interface Listing {
  id: string;
  sellerId: string;
  eventId: string;
  tierId: string;
  quantity: number;
  note: string | null;
  evidence: string;
  status: ListingStatus;
  submittedAt: number;
  decidedAt: number | null;
  decidedBy: string | null;
  reason: string | null;
}

export class ListingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ListingError";
  }
}
