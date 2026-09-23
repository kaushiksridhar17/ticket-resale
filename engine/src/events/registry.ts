import {
  parseSymbol,
  symbolFor,
  type EventDefinition,
  type EventStatus,
  type TierRef,
} from "./types.js";

export class EventRegistry {
  private events = new Map<string, EventDefinition>();
  private issued = new Map<string, number>();

  create(event: EventDefinition): void {
    if (this.events.has(event.id)) {
      throw new Error(`Event ${event.id} already exists`);
    }
    if (event.tiers.length === 0) {
      throw new Error("An event needs at least one tier");
    }
    this.events.set(event.id, {
      ...event,
      tiers: event.tiers.map((tier) => ({ ...tier })),
    });
  }

  get(eventId: string): EventDefinition | null {
    return this.events.get(eventId) ?? null;
  }

  list(): EventDefinition[] {
    return [...this.events.values()];
  }

  symbols(): string[] {
    const symbols: string[] = [];
    for (const event of this.events.values()) {
      for (const tier of event.tiers) {
        symbols.push(symbolFor(event.id, tier.tierId));
      }
    }
    return symbols;
  }

  resolve(symbol: string): TierRef | null {
    const parsed = parseSymbol(symbol);
    if (!parsed) {
      return null;
    }
    const event = this.events.get(parsed.eventId);
    if (!event) {
      return null;
    }
    const tier = event.tiers.find((entry) => entry.tierId === parsed.tierId);
    return tier ? { event, tier } : null;
  }

  isValidSymbol(symbol: string): boolean {
    return this.resolve(symbol) !== null;
  }

  setStatus(eventId: string, status: EventStatus): EventDefinition | null {
    const event = this.events.get(eventId);
    if (!event) {
      return null;
    }
    event.status = status;
    return event;
  }

  recordIssued(symbol: string, count: number): void {
    this.issued.set(symbol, (this.issued.get(symbol) ?? 0) + count);
  }

  issuedCount(symbol: string): number {
    return this.issued.get(symbol) ?? 0;
  }
}
