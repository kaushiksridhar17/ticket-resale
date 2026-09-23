export interface Ticket {
  id: string;
  symbol: string;
  serial: number;
  holderId: string;
  rotation: number;
}

export interface TicketTransfer {
  ticketId: string;
  rotation: number;
  symbol: string;
  fromUserId: string | null;
  toUserId: string;
  tradeId: string | null;
}

export class TicketError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TicketError";
  }
}
