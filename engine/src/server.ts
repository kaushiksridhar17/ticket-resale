import Fastify, { type FastifyError } from "fastify";
import cors from "@fastify/cors";
import websocket from "@fastify/websocket";
import { registerRoutes } from "./api/routes.js";
import { registerHistoryRoutes } from "./api/history.js";
import { registerEventRoutes } from "./api/events.js";
import { registerDoorRoutes } from "./door/routes.js";
import { PassIssuer } from "./door/passes.js";
import { registerWebSocket } from "./ws/routes.js";
import { Broadcaster } from "./ws/broadcaster.js";
import { ExchangeState } from "./exchangeState.js";
import { connectDatabase, type Database } from "./db/database.js";
import { PostgresSink, readLastLogSeq } from "./db/postgresSink.js";
import { PersistenceWriter } from "./db/writer.js";
import { AuthService } from "./auth/service.js";
import { MemoryAuthStore } from "./auth/memoryStore.js";
import { PostgresAuthStore } from "./auth/postgresStore.js";
import { registerAuthPlugin, NotAllowed, NotAuthenticated } from "./auth/plugin.js";
import { registerAuthRoutes } from "./auth/routes.js";
import { bootstrapAdmin, findAdmin, type AdminDetails } from "./auth/bootstrap.js";
import type { Trade } from "./types.js";

export interface ServerOptions {
  logPath?: string | null;
  logger?: boolean;
  broadcastIntervalMs?: number;
  databaseUrl?: string | null;
  authPepper?: string;
  admin?: AdminDetails | null;
  doorKey?: string;
}

export async function buildServer(options: ServerOptions = {}) {
  const logPath =
    options.logPath === undefined ? "data/events.jsonl" : options.logPath;

  const database: Database | null = options.databaseUrl
    ? await connectDatabase(options.databaseUrl)
    : null;
  const lastPersistedLogSeq = database ? await readLastLogSeq(database) : 0;
  const writer = database
    ? new PersistenceWriter(new PostgresSink(database))
    : null;
  writer?.start();

  const state = new ExchangeState(logPath, {
    persistence: writer,
    lastPersistedLogSeq,
  });

  if (database && logPath !== null && lastPersistedLogSeq > state.logPosition()) {
    console.warn(
      `Database has log position ${lastPersistedLogSeq} but the event log only has ${state.logPosition()}. ` +
        "The two have been reset separately; wipe both with `docker compose down -v`."
    );
  }

  const authStore = database
    ? new PostgresAuthStore(database)
    : new MemoryAuthStore();
  const auth = new AuthService(authStore, {
    pepper: options.authPepper ?? process.env.AUTH_PEPPER ?? "development-pepper",
  });

  const admin =
    options.admin !== undefined
      ? options.admin
      : findAdmin(process.env.ADMIN_FILE ?? "admin.json");
  const adminEmail = await bootstrapAdmin(auth, admin);

  const passes = new PassIssuer(
    options.doorKey ?? process.env.DOOR_KEY ?? "development-door-key"
  );

  const broadcaster = new Broadcaster(state, options.broadcastIntervalMs ?? 100);
  const app = Fastify({ logger: options.logger ?? false });

  await app.register(cors, {
    origin: true,
    credentials: true,
    methods: ["GET", "POST", "DELETE", "OPTIONS"],
  });
  await app.register(websocket);
  await registerAuthPlugin(app, auth);

  app.setErrorHandler((error: FastifyError, request, reply) => {
    if (error instanceof NotAuthenticated) {
      return reply.code(401).send({ error: error.message });
    }
    if (error instanceof NotAllowed) {
      return reply.code(403).send({ error: error.message });
    }
    request.log.error(error);
    return reply.code(error.statusCode ?? 500).send({
      error: error.statusCode ? error.message : "Something went wrong",
    });
  });

  const onChange = (symbol: string) => broadcaster.markDirty(symbol);
  const onTrades = (symbol: string, trades: Trade[]) =>
    broadcaster.publishTrades(symbol, trades);

  registerAuthRoutes(app, auth);
  registerRoutes(app, { state, onOrderChange: onChange, onTrades });
  registerEventRoutes(app, { state });
  registerDoorRoutes(app, { state, passes });
  registerHistoryRoutes(app, { state, database });
  registerWebSocket(app, broadcaster);

  app.addHook("onClose", async () => {
    broadcaster.stop();
    await writer?.close();
    state.close();
    await database?.end();
  });

  return { app, state, broadcaster, database, writer, auth, adminEmail };
}
