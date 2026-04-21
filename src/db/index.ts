import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

/**
 * Lazy-initialized Drizzle client.
 *
 * Why lazy: Next.js `next build` evaluates every server module during its
 * "page data collection" pass. If `postgres(DATABASE_URL, ...)` is called at
 * module load and the URL is malformed (stale rotation, bad paste into Vercel
 * env vars, etc.), the whole production build crashes — even though the vast
 * majority of the app doesn't touch the DB.
 *
 * With a Proxy, the connection is only constructed on first property access
 * (i.e., the first `db.select(...)` call). Build-time module evaluation is
 * inert; bad DATABASE_URL errors surface at runtime on the specific request
 * that needs the DB, not during build.
 *
 * Supabase transaction pooler constraints (prepare: false, max: 1) apply.
 * Dev singleton pattern preserves the connection across hot reloads.
 */

type DbInstance = ReturnType<typeof drizzle<typeof schema>>;

let cachedDb: DbInstance | undefined;

function initDb(): DbInstance {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      "DATABASE_URL is required. Set it in .env.local (dev) or Vercel env vars (prod).",
    );
  }

  const globalForDb = globalThis as unknown as {
    __blipsDbClient?: ReturnType<typeof postgres>;
  };

  if (!globalForDb.__blipsDbClient) {
    globalForDb.__blipsDbClient = postgres(connectionString, {
      max: 1,
      prepare: false,
      idle_timeout: 20,
    });
  }

  return drizzle(globalForDb.__blipsDbClient, { schema });
}

export const db = new Proxy({} as DbInstance, {
  get(_target, prop) {
    if (!cachedDb) cachedDb = initDb();
    return Reflect.get(cachedDb as object, prop);
  },
});

// Re-export schema for app-side imports
export * from "./schema";
