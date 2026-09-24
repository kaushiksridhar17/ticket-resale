import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Database } from "./database.js";

const HERE = __dirname;

export interface Migration {
  version: number;
  name: string;
  sql: string;
}

export function loadMigrations(directory = join(HERE, "migrations")): Migration[] {
  return readdirSync(directory)
    .filter((file) => file.endsWith(".sql"))
    .map((file) => {
      const match = /^(\d+)_(.+)\.sql$/.exec(file);
      if (!match) {
        throw new Error(`Migration ${file} is not named like 001_something.sql`);
      }
      return {
        version: Number(match[1]),
        name: match[2]!,
        sql: readFileSync(join(directory, file), "utf8"),
      };
    })
    .sort((a, b) => a.version - b.version);
}

export async function migrate(
  db: Database,
  migrations = loadMigrations()
): Promise<number[]> {
  await db.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  const seen = new Set<number>();
  for (const migration of migrations) {
    if (seen.has(migration.version)) {
      throw new Error(`Two migrations both claim version ${migration.version}`);
    }
    seen.add(migration.version);
  }

  const applied = await db.query<{ version: number }>(
    "SELECT version FROM schema_migrations"
  );
  const done = new Set(applied.rows.map((row) => Number(row.version)));
  const ran: number[] = [];

  for (const migration of migrations) {
    if (done.has(migration.version)) {
      continue;
    }

    const client = await db.connect();
    try {
      await client.query("BEGIN");
      await client.query(migration.sql);
      await client.query(
        "INSERT INTO schema_migrations (version, name) VALUES ($1, $2)",
        [migration.version, migration.name]
      );
      await client.query("COMMIT");
      ran.push(migration.version);
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw new Error(
        `Migration ${migration.version}_${migration.name} failed: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    } finally {
      client.release();
    }
  }

  return ran;
}
