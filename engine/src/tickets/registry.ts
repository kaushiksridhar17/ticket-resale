import { TicketError, type Ticket } from "./types.js";

export class TicketRegistry {
  private tickets = new Map<string, Ticket>();
  private holdings = new Map<string, Map<string, string[]>>();
  private bySymbol = new Map<string, Ticket[]>();
  private nextSerial = new Map<string, number>();
  private counter = 0;

  issue(symbol: string, count: number, holderId: string): Ticket[] {
    if (!Number.isInteger(count) || count <= 0) {
      throw new TicketError("Ticket count must be a positive integer");
    }

    const issued: Ticket[] = [];
    const list = this.listFor(holderId, symbol);
    let serial = this.nextSerial.get(symbol) ?? 1;

    for (let i = 0; i < count; i += 1) {
      this.counter += 1;
      const ticket: Ticket = {
        id: `tkt_${this.counter}`,
        symbol,
        serial,
        holderId,
        rotation: 0,
      };
      this.tickets.set(ticket.id, ticket);
      list.push(ticket.id);
      issued.push(ticket);
      this.index(symbol).push(ticket);
      serial += 1;
    }

    this.nextSerial.set(symbol, serial);
    return issued;
  }

  transfer(
    symbol: string,
    fromUserId: string,
    toUserId: string,
    quantity: number
  ): Ticket[] {
    const source = this.listFor(fromUserId, symbol);
    if (source.length < quantity) {
      throw new TicketError(
        `${fromUserId} holds ${source.length} of ${symbol}, cannot transfer ${quantity}`
      );
    }

    const target = this.listFor(toUserId, symbol);
    const moved = source.splice(0, quantity);

    for (const id of moved) {
      const ticket = this.tickets.get(id);
      if (!ticket) {
        throw new TicketError(`Unknown ticket ${id}`);
      }
      ticket.holderId = toUserId;
      ticket.rotation += 1;
      this.insertBySerial(target, ticket);
    }

    return moved.map((id) => this.tickets.get(id)!);
  }

  get(ticketId: string): Ticket | null {
    return this.tickets.get(ticketId) ?? null;
  }

  heldBy(userId: string, symbol?: string): Ticket[] {
    const bySymbol = this.holdings.get(userId);
    if (!bySymbol) {
      return [];
    }
    if (symbol !== undefined) {
      return (bySymbol.get(symbol) ?? []).map((id) => this.tickets.get(id)!);
    }
    const held: Ticket[] = [];
    for (const ids of bySymbol.values()) {
      for (const id of ids) {
        held.push(this.tickets.get(id)!);
      }
    }
    return held;
  }

  countHeldBy(userId: string, symbol: string): number {
    return this.holdings.get(userId)?.get(symbol)?.length ?? 0;
  }

  forSymbol(symbol: string): Ticket[] {
    return this.bySymbol.get(symbol) ?? [];
  }

  issuedCount(symbol: string): number {
    return (this.nextSerial.get(symbol) ?? 1) - 1;
  }

  size(): number {
    return this.tickets.size;
  }

  assertInvariants(): void {
    const seen = new Set<string>();

    for (const [userId, bySymbol] of this.holdings) {
      for (const [symbol, ids] of bySymbol) {
        for (const id of ids) {
          const ticket = this.tickets.get(id);
          if (!ticket) {
            throw new Error(`${userId} holds unknown ticket ${id}`);
          }
          if (seen.has(id)) {
            throw new Error(`Ticket ${id} is held by more than one account`);
          }
          if (ticket.holderId !== userId) {
            throw new Error(
              `Ticket ${id} is filed under ${userId} but held by ${ticket.holderId}`
            );
          }
          if (ticket.symbol !== symbol) {
            throw new Error(`Ticket ${id} is filed under the wrong symbol`);
          }
          seen.add(id);
        }
      }
    }

    if (seen.size !== this.tickets.size) {
      throw new Error(
        `${this.tickets.size - seen.size} tickets have no holder`
      );
    }
  }

  private index(symbol: string): Ticket[] {
    let tickets = this.bySymbol.get(symbol);
    if (!tickets) {
      tickets = [];
      this.bySymbol.set(symbol, tickets);
    }
    return tickets;
  }

  private listFor(userId: string, symbol: string): string[] {
    let bySymbol = this.holdings.get(userId);
    if (!bySymbol) {
      bySymbol = new Map();
      this.holdings.set(userId, bySymbol);
    }
    let list = bySymbol.get(symbol);
    if (!list) {
      list = [];
      bySymbol.set(symbol, list);
    }
    return list;
  }

  private insertBySerial(list: string[], ticket: Ticket): void {
    let low = 0;
    let high = list.length;
    while (low < high) {
      const mid = (low + high) >>> 1;
      if (this.tickets.get(list[mid]!)!.serial < ticket.serial) {
        low = mid + 1;
      } else {
        high = mid;
      }
    }
    list.splice(low, 0, ticket.id);
  }
}
