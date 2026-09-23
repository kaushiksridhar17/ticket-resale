"use client";

import { useEffect, useRef, useState } from "react";
import { fetchTrades } from "./api";
import type { OrderBookSnapshot, Trade } from "./types";

const WS_URL = process.env.NEXT_PUBLIC_WS_URL ?? "ws://localhost:3001/ws";

type ServerMessage =
  | { type: "book"; symbol: string; book: OrderBookSnapshot }
  | { type: "trades"; symbol: string; trades: Trade[] }
  | { type: "pong" }
  | { type: "error"; error: string };

export type ConnectionStatus = "connecting" | "open" | "closed";

interface Feed {
  symbol: string;
  book: OrderBookSnapshot | null;
  trades: Trade[];
}

interface SocketState {
  status: ConnectionStatus;
  book: OrderBookSnapshot | null;
  trades: Trade[];
}

const MAX_TRADES = 200;

export function useExchangeSocket(symbol: string): SocketState {
  const [status, setStatus] = useState<ConnectionStatus>("connecting");
  const [feed, setFeed] = useState<Feed>({ symbol, book: null, trades: [] });

  const socketRef = useRef<WebSocket | null>(null);
  const reconnectRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const attemptsRef = useRef(0);
  const symbolRef = useRef(symbol);
  const closedByUsRef = useRef(false);

  useEffect(() => {
    symbolRef.current = symbol;

    const socket = socketRef.current;
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: "subscribe", symbol }));
    }

    let cancelled = false;
    fetchTrades(symbol)
      .then((result) => {
        if (cancelled) {
          return;
        }
        setFeed((previous) => {
          if (previous.symbol !== symbol) {
            return previous;
          }
          const seen = new Set(previous.trades.map((trade) => trade.id));
          const historical = result.trades.filter(
            (trade) => !seen.has(trade.id)
          );
          return {
            ...previous,
            trades: [...previous.trades, ...historical].slice(0, MAX_TRADES),
          };
        });
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, [symbol]);

  useEffect(() => {
    closedByUsRef.current = false;

    function connect() {
      setStatus("connecting");
      const socket = new WebSocket(WS_URL);
      socketRef.current = socket;

      socket.onopen = () => {
        attemptsRef.current = 0;
        setStatus("open");
        socket.send(
          JSON.stringify({ type: "subscribe", symbol: symbolRef.current })
        );
      };

      socket.onmessage = (event) => {
        let message: ServerMessage;
        try {
          message = JSON.parse(event.data as string) as ServerMessage;
        } catch {
          return;
        }

        if (message.type === "book") {
          const incoming = message;
          setFeed((previous) =>
            previous.symbol === incoming.symbol
              ? { ...previous, book: incoming.book }
              : previous
          );
          return;
        }

        if (message.type === "trades") {
          const incoming = message;
          setFeed((previous) => {
            if (previous.symbol !== incoming.symbol) {
              return previous;
            }
            const seen = new Set(previous.trades.map((trade) => trade.id));
            const fresh = incoming.trades
              .slice()
              .reverse()
              .filter((trade) => !seen.has(trade.id));
            if (fresh.length === 0) {
              return previous;
            }
            return {
              ...previous,
              trades: [...fresh, ...previous.trades].slice(0, MAX_TRADES),
            };
          });
        }
      };

      socket.onclose = () => {
        setStatus("closed");
        if (closedByUsRef.current) {
          return;
        }
        attemptsRef.current += 1;
        const delay = Math.min(1000 * 2 ** (attemptsRef.current - 1), 10_000);
        reconnectRef.current = setTimeout(connect, delay);
      };

      socket.onerror = () => {
        socket.close();
      };
    }

    connect();

    return () => {
      closedByUsRef.current = true;
      if (reconnectRef.current) {
        clearTimeout(reconnectRef.current);
      }
      socketRef.current?.close();
      socketRef.current = null;
    };
  }, []);

  if (feed.symbol !== symbol) {
    setFeed({ symbol, book: null, trades: [] });
  }

  return { status, book: feed.book, trades: feed.trades };
}