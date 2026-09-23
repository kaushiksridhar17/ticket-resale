import type { WebSocket } from "ws";
import type { ExchangeState } from "../exchangeState.js";
import type { Trade } from "../types.js";

interface Client {
  socket: WebSocket;
  symbols: Set<string>;
}

export class Broadcaster {
  private clients = new Set<Client>();
  private dirty = new Set<string>();
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly state: ExchangeState,
    private readonly intervalMs = 100
  ) {}

  add(socket: WebSocket): Client {
    const client: Client = { socket, symbols: new Set() };
    this.clients.add(client);
    return client;
  }

  remove(client: Client): void {
    this.clients.delete(client);
  }

  subscribe(client: Client, symbol: string): boolean {
    if (!this.state.isValidSymbol(symbol)) {
      return false;
    }
    client.symbols.add(symbol);
    this.sendBook(client, symbol);
    return true;
  }

  unsubscribe(client: Client, symbol: string): void {
    client.symbols.delete(symbol);
  }

  markDirty(symbol: string): void {
    this.dirty.add(symbol);
    this.ensureTimer();
  }

  publishTrades(symbol: string, trades: Trade[]): void {
    if (trades.length === 0) {
      return;
    }
    const message = JSON.stringify({ type: "trades", symbol, trades });
    for (const client of this.clients) {
      if (client.symbols.has(symbol)) {
        this.send(client, message);
      }
    }
    this.markDirty(symbol);
  }

  clientCount(): number {
    return this.clients.size;
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private ensureTimer(): void {
    if (this.timer) {
      return;
    }
    this.timer = setInterval(() => this.flush(), this.intervalMs);
    this.timer.unref();
  }

  private flush(): void {
    if (this.dirty.size === 0) {
      return;
    }
    const symbols = [...this.dirty];
    this.dirty.clear();

    for (const symbol of symbols) {
      const message = JSON.stringify({
        type: "book",
        symbol,
        book: this.state.exchange.engine.snapshot(symbol, 15),
      });
      for (const client of this.clients) {
        if (client.symbols.has(symbol)) {
          this.send(client, message);
        }
      }
    }
  }

  private sendBook(client: Client, symbol: string): void {
    this.send(
      client,
      JSON.stringify({
        type: "book",
        symbol,
        book: this.state.exchange.engine.snapshot(symbol, 15),
      })
    );
  }

  private send(client: Client, message: string): void {
    if (client.socket.readyState === 1) {
      client.socket.send(message);
    }
  }
}