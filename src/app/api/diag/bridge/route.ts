import { NextResponse } from "next/server";
import postgres from "postgres";

/**
 * PUBLIC_API: temporary diagnostic — DO NOT KEEP IN PROD.
 *
 * Returns the four Bridge queries' raw row counts and a sample, served from
 * a fresh, dedicated postgres connection that ignores any globalThis cache.
 * Used to verify whether the route-rendered RSC payload returning stale data
 * is a data-layer issue (we'd see staleness here too) or a Next.js/React
 * issue (we'd see freshness here while the route stays stale).
 *
 * Also records timestamps so we can correlate request arrival vs DB query
 * execution.
 */
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";
export const runtime = "nodejs";

export async function GET() {
  const requestArrivedAt = new Date().toISOString();
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    return NextResponse.json({ ok: false, error: "no DATABASE_URL" });
  }

  // FRESH connection per request — explicitly no globalThis cache reuse.
  const sql = postgres(dbUrl, {
    max: 1,
    prepare: false,
    connect_timeout: 8,
    idle_timeout: 1,
  });

  try {
    const beforeOrg = Date.now();
    const [org] =
      (await sql`SELECT id FROM orgs WHERE slug = 'blips' LIMIT 1`) as Array<{
        id: string;
      }>;
    const orgMs = Date.now() - beforeOrg;

    if (!org) {
      return NextResponse.json({ ok: false, error: "no blips org" });
    }

    const beforeQueries = Date.now();
    const [pendingCount, runningCols, recentCands, recentRuns] =
      await Promise.all([
        sql`SELECT COUNT(*)::int AS n FROM bunker_candidates WHERE org_id = ${org.id} AND status = 'PENDING_REVIEW'`,
        sql`SELECT id, name, status, created_at, updated_at FROM collections WHERE org_id = ${org.id} AND status IN ('queued', 'running') ORDER BY updated_at DESC LIMIT 10`,
        sql`SELECT shortcode, collection_id, status, created_at FROM bunker_candidates WHERE org_id = ${org.id} AND status = 'PENDING_REVIEW' ORDER BY created_at DESC LIMIT 10`,
        sql`SELECT collection_id, status, fetched_raw, extracted, created_at FROM collection_runs WHERE org_id = ${org.id} ORDER BY created_at DESC LIMIT 5`,
      ]);
    const queriesMs = Date.now() - beforeQueries;

    const dbNowResult = (await sql`SELECT now() AS db_now`) as Array<{
      db_now: Date;
    }>;
    const responseSentAt = new Date().toISOString();

    return NextResponse.json({
      ok: true,
      timings: {
        requestArrivedAt,
        responseSentAt,
        dbNowAtQuery: dbNowResult[0].db_now,
        orgFetchMs: orgMs,
        bridgeQueriesMs: queriesMs,
      },
      data: {
        pending_review_count: pendingCount[0].n,
        running_collections_count: runningCols.length,
        running_collections: runningCols.map((c) => ({
          name: c.name,
          status: c.status,
          updated_at: c.updated_at,
        })),
        recent_candidates: recentCands.map((c) => ({
          shortcode: c.shortcode,
          collection_id_short: c.collection_id?.slice(0, 8) ?? null,
          created_at: c.created_at,
        })),
        recent_runs: recentRuns.map((r) => ({
          collection_id_short: r.collection_id.slice(0, 8),
          status: r.status,
          extracted: r.extracted,
          created_at: r.created_at,
        })),
      },
      env: {
        node_env: process.env.NODE_ENV,
        db_host: new URL(dbUrl).host,
      },
    });
  } catch (e) {
    return NextResponse.json({
      ok: false,
      error: e instanceof Error ? e.message : String(e),
      stack:
        e instanceof Error
          ? e.stack?.split("\n").slice(0, 5).join("\n")
          : undefined,
    });
  } finally {
    try {
      await sql.end({ timeout: 1 });
    } catch {
      // best-effort
    }
  }
}
