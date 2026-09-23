import { buildServer } from "./server.js";

const PORT = Number(process.env.PORT ?? 3001);
const HOST = process.env.HOST ?? "0.0.0.0";
const LOGGER = process.env.LOGGER !== "false";
const DATABASE_URL = process.env.DATABASE_URL ?? null;

async function main() {
  const { app, state, database } = await buildServer({
    logger: LOGGER,
    databaseUrl: DATABASE_URL,
  });

  try {
    await app.listen({ port: PORT, host: HOST });
    console.log(`API listening on http://localhost:${PORT}`);
    console.log(`logger=${LOGGER} database=${database ? "on" : "off"}`);
    if (state.recovered > 0) {
      console.log(`Recovered ${state.recovered} commands from the event log`);
    }
    if (database) {
      console.log(
        `Queued ${state.requeuedForDatabase} recovered commands for the database`
      );
    }
  } catch (error) {
    console.error(error);
    process.exit(1);
  }

  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, async () => {
      await app.close();
      process.exit(0);
    });
  }
}

main();