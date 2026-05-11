/**
 * Apply migrations 0001-0010 directly via postgres connection.
 *
 * The drizzle journal (_journal.json) only tracks 0000. Migrations 0001+
 * were applied piecemeal via Supabase MCP `apply_migration` on the old
 * project, never journal-tracked. After Supabase migration to a fresh
 * project, this script applies the missing files in order.
 *
 * One-shot. After this runs, the new project schema matches the old.
 */
import postgres from "postgres";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const envFile = readFileSync(
  "/Users/inbaraj/blips-bos/.env.local",
  "utf-8",
);
for (const line of envFile.split("\n")) {
  const t = line.trim();
  if (!t || t.startsWith("#")) continue;
  const eq = t.indexOf("=");
  if (eq === -1) continue;
  const k = t.slice(0, eq).trim();
  const v = t
    .slice(eq + 1)
    .trim()
    .replace(/^["']|["']$/g, "");
  if (!process.env[k]) process.env[k] = v;
}

const MIGRATIONS_DIR = "/Users/inbaraj/blips-bos/drizzle";
const SKIP = new Set(["0000_groovy_iron_monger.sql"]); // already applied via journal

async function main() {
  const sql = postgres(process.env.DATABASE_URL!, {
    max: 1,
    prepare: false,
  });
  try {
    const files = readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith(".sql") && !f.startsWith("_") && !SKIP.has(f))
      .filter((f) => /^\d+_/.test(f)) // only 0NNN_ prefixed
      .sort();

    console.log(`Found ${files.length} pending migrations:`);
    files.forEach((f) => console.log(`  - ${f}`));

    for (const file of files) {
      const sqlText = readFileSync(join(MIGRATIONS_DIR, file), "utf-8");
      // Strip drizzle's statement-breakpoint comments; split on `--> statement-breakpoint` markers
      const statements = sqlText
        .split("--> statement-breakpoint")
        .map((s) => s.trim())
        .filter(Boolean);

      console.log(`\n→ ${file} (${statements.length} statements)`);
      for (let i = 0; i < statements.length; i++) {
        const stmt = statements[i];
        try {
          await sql.unsafe(stmt);
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          // Many migrations are idempotent in spirit (CREATE TYPE will fail
          // if exists, ALTER TYPE ADD VALUE IF NOT EXISTS won't, etc.)
          // Tolerate "already exists" / "duplicate" errors; fail loudly on
          // anything else.
          if (
            msg.includes("already exists") ||
            msg.includes("duplicate")
          ) {
            console.log(`    ~ stmt ${i + 1}: skipped (already exists)`);
          } else {
            console.error(`    ✗ stmt ${i + 1}: ${msg.slice(0, 200)}`);
            throw e;
          }
        }
      }
      console.log(`  ✓ ${file} applied`);
    }

    // Verify enum values
    const enums =
      (await sql`SELECT enumlabel FROM pg_enum WHERE enumtypid = (SELECT oid FROM pg_type WHERE typname = 'signal_status') ORDER BY enumsortorder`) as Array<{
        enumlabel: string;
      }>;
    console.log(
      `\nFinal signal_status enum (${enums.length} values):`,
      enums.map((e) => e.enumlabel).join(", "),
    );
  } finally {
    await sql.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
