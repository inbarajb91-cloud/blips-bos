import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is required");
}

/**
 * Postgres connection pool for Drizzle.
 *
 * Supabase transaction pooler (:6543) constraints:
 * - prepare: false — transaction pooler doesn't support prepared statements
 * - max: 1 for serverless edge, higher for local dev / long-running procs
 *
 * `postgres` (postgres.js) is the recommended driver for Drizzle on Supabase.
 */
const connectionString = process.env.DATABASE_URL;

// Reuse a single client across hot-reloads in dev
const globalForDb = globalThis as unknown as {
  client?: ReturnType<typeof postgres>;
};

const client =
  globalForDb.client ??
  postgres(connectionString, {
    max: 1,
    prepare: false,
    idle_timeout: 20,
  });

if (process.env.NODE_ENV !== "production") {
  globalForDb.client = client;
}

export const db = drizzle(client, { schema });

// Re-export schema for app-side imports
export * from "./schema";
