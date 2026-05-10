import { NextResponse } from "next/server";
import postgres from "postgres";

/**
 * PUBLIC_API: temporary diagnostic — DO NOT KEEP IN PROD.
 *
 * Returns the actual postgres error from the running Vercel function so we
 * can see WHY /engine-room is failing. Vercel's runtime log truncates the
 * SQL error body. This route surfaces it in the response JSON.
 *
 * Will be removed after diagnosis. No secrets in response.
 */
export const dynamic = "force-dynamic";

export async function GET() {
  const dbUrl = process.env.DATABASE_URL;
  const supaUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;

  // Reveal which projects we're pointed at (host only, no credentials).
  const dbHost = dbUrl ? new URL(dbUrl).host : "MISSING";
  const supaHost = supaUrl ? new URL(supaUrl).host : "MISSING";

  if (!dbUrl) {
    return NextResponse.json({
      ok: false,
      stage: "env",
      error: "DATABASE_URL is not set",
      dbHost,
      supaHost,
    });
  }

  // Attempt a 1-shot connection + trivial query.
  const sql = postgres(dbUrl, {
    max: 1,
    prepare: false,
    connect_timeout: 10,
    idle_timeout: 5,
  });

  try {
    const t0 = Date.now();
    const r =
      await sql`SELECT current_database() AS db, version() AS pg, count(*) AS orgs FROM orgs`;
    const elapsed = Date.now() - t0;

    // Replicate the exact failing Bridge query (signals select).
    let signalsCheck: { ok: boolean; error?: string; rows?: number } = {
      ok: false,
    };
    try {
      const sigs =
        await sql`SELECT id, parent_signal_id, manifestation_decade, collection_id, status FROM signals LIMIT 1`;
      signalsCheck = { ok: true, rows: sigs.length };
    } catch (e) {
      signalsCheck = {
        ok: false,
        error: e instanceof Error ? e.message : String(e),
      };
    }

    return NextResponse.json({
      ok: true,
      dbHost,
      supaHost,
      elapsed_ms: elapsed,
      probe: r[0],
      signalsCheck,
    });
  } catch (e) {
    const err = e as Error & { code?: string; errno?: string };
    return NextResponse.json({
      ok: false,
      stage: "connect_or_query",
      dbHost,
      supaHost,
      error: err.message,
      errorCode: err.code ?? null,
      errorErrno: err.errno ?? null,
      stack: err.stack?.split("\n").slice(0, 5).join("\n") ?? null,
    });
  } finally {
    try {
      await sql.end({ timeout: 2 });
    } catch {
      // best effort
    }
  }
}
