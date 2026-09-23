export interface Ticket {
  id: string;
  symbol: string;
  serial: number;
  holderId: string;
  rotation: number;
}

export class TicketError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TicketError";
  }
}
