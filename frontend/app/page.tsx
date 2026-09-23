"use client";

import { useEffect, useState } from "react";
import { fetchSymbols } from "@/lib/api";
import { useExchangeSocket } from "@/lib/useExchangeSocket";
import { useAccount } from "@/lib/useAccount";
import { OrderBook } from "@/components/OrderBook";
import { TradeFeed } from "@/components/TradeFeed";
import { OrderForm } from "@/components/OrderForm";
import { Portfolio } from "@/components/Portfolio";
import { PriceChart } from "@/components/PriceChart";

function loadUserId(): string {
  try {
    const existing = window.localStorage.getItem("exchange-user-id");
    if (existing) {
      return existing;
    }
    const generated = `trader_${Math.random().toString(36).slice(2, 8)}`;
    window.localStorage.setItem("exchange-user-id", generated);
    return generated;
  } catch {
    return "trader";
  }
}

export default function Home() {
  const [symbols, setSymbols] = useState<string[]>([]);
  const [symbol, setSymbol] = useState("ACME");
  const [userId, setUserId] = useState("trader");
  const [selectedPrice, setSelectedPrice] = useState<number | null>(null);

  const { status, book, trades } = useExchangeSocket(symbol);
  const { account, refresh } = useAccount(userId);

  useEffect(() => {
    setUserId(loadUserId());
  }, []);

  useEffect(() => {
    fetchSymbols()
      .then((result) => setSymbols(result.symbols))
      .catch(() => setSymbols([]));
  }, []);

  useEffect(() => {
    const timer = setInterval(() => void refresh(), 2000);
    return () => clearInterval(timer);
  }, [refresh]);

  const statusColor =
    status === "open"
      ? "bg-emerald-500"
      : status === "connecting"
        ? "bg-amber-500"
        : "bg-rose-500";

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100">
      <div className="mx-auto max-w-7xl px-6 py-8">
        <header className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold tracking-tight">Exchange</h1>
            <p className="text-xs text-slate-500">trading as {userId}</p>
          </div>
          <div className="flex items-center gap-2 text-xs text-slate-500">
            <span className={`h-2 w-2 rounded-full ${statusColor}`} />
            {status}
          </div>
        </header>

        <div className="mb-6 flex gap-2">
          {symbols.map((option) => (
            <button
              key={option}
              onClick={() => setSymbol(option)}
              className={`rounded px-4 py-1.5 text-sm font-medium transition ${
                option === symbol
                  ? "bg-slate-100 text-slate-900"
                  : "bg-slate-900 text-slate-400 hover:bg-slate-800"
              }`}
            >
              {option}
            </button>
          ))}
        </div>

        <div className="mb-4">
          <PriceChart symbol={symbol} trades={trades} />
        </div>

        <div className="grid gap-4 lg:grid-cols-4">
          <div className="lg:col-span-1">
            <OrderBook book={book} onPriceClick={setSelectedPrice} />
          </div>
          <div className="lg:col-span-1">
            <TradeFeed trades={trades} userId={userId} />
          </div>
          <div className="lg:col-span-1">
            <OrderForm
              userId={userId}
              symbol={symbol}
              account={account}
              selectedPrice={selectedPrice}
              bestBid={book?.bids[0]?.priceInCents ?? null}
              bestAsk={book?.asks[0]?.priceInCents ?? null}
              onPlaced={refresh}
            />
          </div>
          <div className="lg:col-span-1">
            <Portfolio account={account} onChanged={refresh} />
          </div>
        </div>
      </div>
    </main>
  );
}