import { ListingError, type Listing, type ListingStatus } from "./types.js";

export class ListingRegistry {
  private listings = new Map<string, Listing>();

  add(listing: Listing): void {
    if (this.listings.has(listing.id)) {
      throw new ListingError(`Listing ${listing.id} already exists`);
    }
    this.listings.set(listing.id, { ...listing });
  }

  get(listingId: string): Listing | null {
    const listing = this.listings.get(listingId);
    return listing ? { ...listing } : null;
  }

  decide(
    listingId: string,
    status: Exclude<ListingStatus, "pending">,
    decidedBy: string,
    decidedAt: number,
    reason: string | null
  ): Listing {
    const listing = this.listings.get(listingId);
    if (!listing) {
      throw new ListingError(`Unknown listing ${listingId}`);
    }
    if (listing.status !== "pending") {
      throw new ListingError(`Listing ${listingId} was already ${listing.status}`);
    }

    listing.status = status;
    listing.decidedBy = decidedBy;
    listing.decidedAt = decidedAt;
    listing.reason = reason;

    return { ...listing };
  }

  list(filter: { sellerId?: string; status?: ListingStatus } = {}): Listing[] {
    const found: Listing[] = [];
    for (const listing of this.listings.values()) {
      if (filter.sellerId && listing.sellerId !== filter.sellerId) {
        continue;
      }
      if (filter.status && listing.status !== filter.status) {
        continue;
      }
      found.push({ ...listing });
    }
    return found.sort((a, b) => b.submittedAt - a.submittedAt);
  }

  countPending(): number {
    let count = 0;
    for (const listing of this.listings.values()) {
      if (listing.status === "pending") {
        count += 1;
      }
    }
    return count;
  }

  pendingQuantity(sellerId: string, symbolEventId: string, tierId: string): number {
    let total = 0;
    for (const listing of this.listings.values()) {
      if (
        listing.sellerId === sellerId &&
        listing.eventId === symbolEventId &&
        listing.tierId === tierId &&
        listing.status === "pending"
      ) {
        total += listing.quantity;
      }
    }
    return total;
  }

  size(): number {
    return this.listings.size;
  }
}
