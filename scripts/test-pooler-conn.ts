/**
 * Verify the Supavisor Transaction Pooler URL works against the new DB
 * before swapping Vercel's DATABASE_URL.
 *
 * Pulls the password from .env.local's existing DATABASE_URL so we don't
 * hardcode credentials in source.
 */
import { readFileSync } from "node:fs";
import postgres from "postgres";

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

async function main() {
  const direct = process.env.DATABASE_URL!;
  const u = new URL(direct);
  // direct: postgresql://postgres:PWD@db.PROJECT.supabase.co:5432/postgres
  // pooler: postgresql://postgres.PROJECT:PWD@aws-0-REGION.pooler.supabase.com:6543/postgres
  const projectRef = u.host.split(".")[0].replace(/^db\.?/, "") || "hbkpzkntaglghtrazpyj";
  // pull project ref from hostname db.{ref}.supabase.co
  const refMatch = u.host.match(/^db\.([^.]+)\.supabase\.co/);
  const ref = refMatch?.[1] ?? projectRef;
  const regions = [
    "ap-south-1",
    "ap-southeast-1",
    "ap-southeast-2",
    "ap-northeast-1",
    "ap-northeast-2",
    "us-east-1",
    "us-east-2",
    "us-west-1",
    "us-west-2",
    "ca-central-1",
    "eu-central-1",
    "eu-west-1",
    "eu-west-2",
    "eu-west-3",
    "eu-north-1",
    "sa-east-1",
  ];

  for (const region of regions) {
    const poolerUrl = `postgresql://postgres.${ref}:${u.password}@aws-1-${region}.pooler.supabase.com:6543/postgres`;
    process.stdout.write(
      `Testing aws-1-${region}.pooler.supabase.com... `,
    );
    const sql = postgres(poolerUrl, {
      max: 1,
      prepare: false,
      connect_timeout: 8,
      idle_timeout: 2,
    });
    try {
      const r = await sql`SELECT 1 AS ok`;
      console.log(`✓ OK (rows=${r.length}) — region=${region}`);
      // Run the bridge query
      const sigs =
        await sql`SELECT id, parent_signal_id, manifestation_decade FROM signals LIMIT 1`;
      console.log(`  ✓ signals query OK (${sigs.length} rows)`);
      console.log(
        `\n>>> USE THIS DATABASE_URL ON VERCEL:\npostgresql://postgres.${ref}:[your-password]@aws-1-${region}.pooler.supabase.com:6543/postgres\n`,
      );
      await sql.end({ timeout: 2 });
      return;
    } catch (e) {
      console.log(`✗ ${e instanceof Error ? e.message : e}`);
      try {
        await sql.end({ timeout: 2 });
      } catch {
        // best effort
      }
    }
  }
  console.error("\nNo region accepted the connection.");
  process.exit(1);
}

main().catch((e) => {
  console.error("[test-pooler] FAILED:", e instanceof Error ? e.message : e);
  process.exit(1);
});
