import type { FastifyInstance, FastifyReply } from "fastify";
import type { Database } from "../db/database.js";
import type { ExchangeState } from "../exchangeState.js";
import { orderHistory, tradeHistory } from "../db/queries.js";
import { requireUser } from "../auth/plugin.js";

export interface HistoryDeps {
  state: ExchangeState;
  database: Database | null;
}

const pageSchema = {
  querystring: {
    type: "object",
    properties: {
      before: { type: "integer", minimum: 1 },
      limit: { type: "integer", minimum: 1, maximum: 500 },
    },
  },
} as const;

function unavailable(reply: FastifyReply) {
  return reply
    .code(503)
    .send({ error: "History is unavailable because no database is configured" });
}

export function registerHistoryRoutes(
  app: FastifyInstance,
  deps: HistoryDeps
): void {
  const { state, database } = deps;

  app.get(
    "/history/trades/:symbol",
    { schema: pageSchema },
    async (request, reply) => {
      const { symbol } = request.params as { symbol: string };
      const { before, limit = 100 } = request.query as {
        before?: number;
        limit?: number;
      };

      if (!state.isValidSymbol(symbol)) {
        return reply.code(404).send({ error: `Unknown symbol ${symbol}` });
      }
      if (!database) {
        return unavailable(reply);
      }

      const trades = await tradeHistory(database, symbol, limit, before ?? null);
      const last = trades[trades.length - 1];

      return {
        trades,
        nextBefore: trades.length === limit && last ? last.sequence : null,
      };
    }
  );

  app.get("/history/orders", { schema: pageSchema }, async (request, reply) => {
    const user = requireUser(request);
    const { before, limit = 100 } = request.query as {
      before?: number;
      limit?: number;
    };

    if (!database) {
      return unavailable(reply);
    }

    const orders = await orderHistory(database, user.id, limit, before ?? null);
    const last = orders[orders.length - 1];

    return {
      orders,
      nextBefore: orders.length === limit && last ? last.sequence : null,
    };
  });
}
