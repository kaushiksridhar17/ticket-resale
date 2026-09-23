import { buildServer } from "./server.js";

const PORT = Number(process.env.PORT ?? 3001);
const HOST = process.env.HOST ?? "0.0.0.0";
const LOGGER = process.env.LOGGER !== "false";
const DATABASE_URL = process.env.DATABASE_URL ?? null;
const AUTH_PEPPER = process.env.AUTH_PEPPER ?? null;
const LOG_PATH = process.env.LOG_PATH ?? undefined;

async function main() {
  if (process.env.NODE_ENV === "production") {
    const secrets = [
      ["AUTH_PEPPER", AUTH_PEPPER, "development-pepper"],
      ["DOOR_KEY", process.env.DOOR_KEY ?? null, "development-door-key"],
    ] as const;

    for (const [name, value, placeholder] of secrets) {
      if (!value) {
        console.error(`${name} must be set in production`);
        process.exit(1);
      }
      if (value === placeholder) {
        console.warn(
          `${name} is still the value this project ships with. Anybody who has ` +
            "read the source can forge sessions or door passes. Set a real one " +
            "before this is reachable from outside your machine."
        );
      }
    }

    if (process.env.SECURE_COOKIES === "false") {
      console.warn(
        "SECURE_COOKIES=false, so sign-in cookies travel over plain HTTP. " +
          "Fine on your own machine, not behind a real domain."
      );
    }
  }

  const { app, state, database } = await buildServer({
    logger: LOGGER,
    databaseUrl: DATABASE_URL,
    ...(LOG_PATH ? { logPath: LOG_PATH } : {}),
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