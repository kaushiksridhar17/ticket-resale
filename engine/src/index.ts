import { buildServer } from "./server.js";

const PORT = Number(process.env.PORT ?? 3001);
const HOST = process.env.HOST ?? "0.0.0.0";
const LOGGER = process.env.LOGGER !== "false";
const DATABASE_URL = process.env.DATABASE_URL ?? null;
const AUTH_PEPPER = process.env.AUTH_PEPPER ?? null;

async function main() {
  if (process.env.NODE_ENV === "production") {
    for (const [name, value] of [
      ["AUTH_PEPPER", AUTH_PEPPER],
      ["DOOR_KEY", process.env.DOOR_KEY ?? null],
    ] as const) {
      if (!value) {
        console.error(`${name} must be set in production`);
        process.exit(1);
      }
    }
  }

  const { app, state, database } = await buildServer({
    logger: LOGGER,
    databaseUrl: DATABASE_URL,
    ...(AUTH_PEPPER ? { authPepper: AUTH_PEPPER } : {}),
  });

  try {
    await app.listen({ port: PORT, host: HOST });
    console.log(`Face Value API listening on http://localhost:${PORT}`);
    console.log(
      `logger=${LOGGER} database=${database ? "on" : "off"}`
    );
    if (!DATABASE_URL) {
      console.warn(
        "No DATABASE_URL. Events survive in the log but accounts do not: " +
          "everyone gets a new identity when this restarts, and organizers " +
          "lose their events."
      );
    }
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