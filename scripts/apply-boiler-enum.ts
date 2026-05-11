import postgres from "postgres";
import { readFileSync } from "node:fs";

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
  const sql = postgres(process.env.DATABASE_URL!, {
    max: 1,
    prepare: false,
  });
  try {
    await sql`ALTER TYPE signal_status ADD VALUE IF NOT EXISTS 'BOILER_REFUSED'`;
    console.log("✓ Added BOILER_REFUSED to signal_status enum");
    const result =
      (await sql`SELECT enumlabel FROM pg_enum WHERE enumtypid = (SELECT oid FROM pg_type WHERE typname = 'signal_status') ORDER BY enumsortorder`) as Array<{
        enumlabel: string;
      }>;
    console.log(
      "Current signal_status values:",
      result.map((r) => r.enumlabel).join(", "),
    );
  } finally {
    await sql.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
