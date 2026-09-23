import type { FastifyInstance } from "fastify";
import { OrderRejected } from "../exchange.js";
import { placeOrderSchema, type PlaceOrderBody } from "./schemas.js";
import { requireUser } from "../auth/plugin.js";
import type { ExchangeState } from "../exchangeState.js";
import type { Order, Trade } from "../types.js";

export interface RouteDeps {
  state: ExchangeState;
  onOrderChange?: (symbol: string) => void;
  onTrades?: (symbol: string, trades: Trade[]) => void;
}

export function registerRoutes(app: FastifyInstance, deps: RouteDeps): void {
  const { state } = deps;

  app.get("/health", async () => ({ status: "ok" }));

  app.get("/symbols", async () => ({ symbols: state.symbols() }));

  app.get("/book/:symbol", async (request, reply) => {
    const { symbol } = request.params as { symbol: string };
    if (!state.isValidSymbol(symbol)) {
      return reply.code(404).send({ error: `Unknown symbol ${symbol}` });
    }
    return state.exchange.engine.snapshot(symbol, 15);
  });

  app.get("/trades/:symbol", async (request, reply) => {
    const { symbol } = request.params as { symbol: string };
    if (!state.isValidSymbol(symbol)) {
      return reply.code(404).send({ error: `Unknown symbol ${symbol}` });
    }
    return { trades: state.recentTrades(symbol) };
  });

  app.get("/account", async (request) => {
    const user = requireUser(request);
    state.ensureAccount(user.id);

    const account = state.exchange.accounts.get(user.id);
    const positions = state.symbols().map((symbol) => ({
      symbol,
      total: account.positions.get(symbol)?.total ?? 0,
      locked: account.positions.get(symbol)?.locked ?? 0,
    }));

    return {
      userId: user.id,
      positions,
      orders: state.ordersFor(user.id).slice(-50).reverse(),
    };
  });

  app.post("/orders", { schema: placeOrderSchema }, async (request, reply) => {
    const user = requireUser(request);
    const body = request.body as PlaceOrderBody;

    if (!state.isValidSymbol(body.symbol)) {
      return reply.code(400).send({ error: `Unknown symbol ${body.symbol}` });
    }
    if (body.type === "limit" && body.priceInCents === undefined) {
      return reply.code(400).send({ error: "Limit orders require priceInCents" });
    }
    if (body.type === "market" && body.priceInCents !== undefined) {
      return reply
        .code(400)
        .send({ error: "Market orders must not include priceInCents" });
    }

    state.ensureAccount(user.id);

    const order: Order = {
      id: state.nextOrderId(),
      userId: user.id,
      symbol: body.symbol,
      side: body.side,
      type: body.type,
      priceInCents: body.type === "limit" ? body.priceInCents! : null,
      quantity: body.quantity,
      remainingQuantity: body.quantity,
      status: "open",
      sequence: 0,
      createdAt: Date.now(),
    };

    try {
      const result = state.submitOrder(order);

      deps.onOrderChange?.(body.symbol);
      if (result.trades.length > 0) {
        deps.onTrades?.(body.symbol, result.trades);
      }

      return reply.code(201).send({
        order: result.order,
        trades: result.trades,
      });
    } catch (error) {
      if (error instanceof OrderRejected) {
        return reply.code(422).send({ error: error.message });
      }
      throw error;
    }
  });

  app.delete("/orders/:orderId", async (request, reply) => {
    const user = requireUser(request);
    const { orderId } = request.params as { orderId: string };
    const existing = state.getOrder(orderId);

    if (!existing) {
      return reply.code(404).send({ error: `Unknown order ${orderId}` });
    }
    if (existing.userId !== user.id) {
      return reply.code(403).send({ error: "That order is not yours" });
    }

    const cancelled = state.cancelOrder(existing.symbol, orderId);
    if (!cancelled) {
      return reply
        .code(409)
        .send({ error: "Order is no longer active", order: existing });
    }

    deps.onOrderChange?.(existing.symbol);

    return { order: cancelled };
  });
}