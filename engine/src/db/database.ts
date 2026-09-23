import pg from "pg";
import { SCHEMA } from "./schema.js";

export type Database = pg.Pool;

export async function connectDatabase(url: string): Promise<Database> {
  const pool = new pg.Pool({ connectionString: url, max: 5 });

  pool.on("error", (error) => {
    console.error("Idle database connection error", error.message);
  });

  await waitForDatabase(pool);
  await pool.query(SCHEMA);
  return pool;
}

async function waitForDatabase(pool: Database, attempts = 15): Promise<void> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      await pool.query("SELECT 1");
      return;
    } catch (error) {
      if (attempt >= attempts) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
}