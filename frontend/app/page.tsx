"use client";

import { useEffect, useState } from "react";
import { fetchSymbols } from "@/lib/api";
import { useExchangeSocket } from "@/lib/useExchangeSocket";
import { useAccount } from "@/lib/useAccount";
import { useSession } from "@/lib/useSession";
import { SignIn } from "@/components/SignIn";
import { OrderBook } from "@/components/OrderBook";
import { TradeFeed } from "@/components/TradeFeed";
import { OrderForm } from "@/components/OrderForm";
import { Portfolio } from "@/components/Portfolio";
import { PriceChart } from "@/components/PriceChart";

export default function Home() {
  const [symbols, setSymbols] = useState<string[]>([]);
  const [symbol, setSymbol] = useState("ACME");
  const [selectedPrice, setSelectedPrice] = useState<number | null>(null);

  const { user, loading, setUser, logout } = useSession();
  const { status, book, trades } = useExchangeSocket(symbol);
  const { account, refresh } = useAccount(user !== null);

  useEffect(() => {
    fetchSymbols()
      .then((result) => setSymbols(result.symbols))
      .catch(() => setSymbols([]));
  }, []);

  useEffect(() => {
    if (!user) {
      return;
    }
    const timer = setInterval(() => void refresh(), 2000);
    return () => clearInterval(timer);
  }, [refresh, user]);

  const statusColor =
    status === "open"
      ? "bg-emerald-500"
      : status === "connecting"
        ? "bg-amber-500"
        : "bg-rose-500";

  if (loading) {
    return (
      <main className="min-h-screen bg-slate-950 text-slate-100">
        <p className="mt-24 text-center text-sm text-slate-600">Loading</p>
      </main>
    );
  }

  if (!user) {
    return (
      <main className="min-h-screen bg-slate-950 px-6 text-slate-100">
        <SignIn onSignedIn={setUser} />
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100">
      <div className="mx-auto max-w-7xl px-6 py-8">
        <header className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold tracking-tight">Exchange</h1>
            <p className="text-xs text-slate-500">
              signed in as {user.email}
              <button
                onClick={() => void logout()}
                className="ml-3 text-slate-600 underline hover:text-slate-400"
              >
                sign out
              </button>
            </p>
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
            <TradeFeed trades={trades} userId={account?.userId ?? user.id} />
          </div>
          <div className="lg:col-span-1">
            <OrderForm
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