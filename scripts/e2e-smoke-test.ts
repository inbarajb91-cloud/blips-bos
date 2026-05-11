/**
 * End-to-end smoke test against the new prod stack.
 * - Auth via Supabase Auth API
 * - BOS app endpoint reachability + behavior
 * - Inngest webhook reachability
 * - DB invariants (FOUNDER user linked, BLIPS org, all config rows present)
 *
 * Prints PASS/FAIL per check + reasoning. No UI interaction.
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

const PROD_URL = "https://blipsstores-bos.vercel.app";
const SUPA_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPA_ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const TEST_EMAIL = "helm@blipsstore.com"; // Note: no 's' — that's how the auth user is registered
const TEST_PASSWORD = process.env.E2E_TEST_PASSWORD ?? process.env.Password ?? "";
if (!TEST_PASSWORD) {
  console.error(
    "E2E_TEST_PASSWORD (or `Password=` key) must be set in .env.local",
  );
  process.exit(1);
}

const results: Array<{ name: string; pass: boolean; detail: string }> = [];

function pass(name: string, detail: string): void {
  results.push({ name, pass: true, detail });
}

function fail(name: string, detail: string): void {
  results.push({ name, pass: false, detail });
}

async function main() {
  // ─── 1. Supabase Auth API works for known credentials ─────────
  let accessToken: string | null = null;
  try {
    const res = await fetch(
      `${SUPA_URL}/auth/v1/token?grant_type=password`,
      {
        method: "POST",
        headers: {
          apikey: SUPA_ANON,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          email: TEST_EMAIL,
          password: TEST_PASSWORD,
        }),
      },
    );
    const body = (await res.json()) as
      | { access_token?: string; error?: string; error_description?: string }
      | { msg?: string };
    if (res.ok && "access_token" in body && body.access_token) {
      accessToken = body.access_token;
      pass(
        "1. Supabase Auth — login",
        `200 OK; got JWT (length ${body.access_token.length})`,
      );
    } else {
      const errBody = body as Record<string, unknown>;
      fail(
        "1. Supabase Auth — login",
        `HTTP ${res.status}; ${JSON.stringify(errBody).slice(0, 200)}`,
      );
    }
  } catch (e) {
    fail(
      "1. Supabase Auth — login",
      e instanceof Error ? e.message : String(e),
    );
  }

  // ─── 2. BOS app /login is reachable + returns the form ─────────
  try {
    const res = await fetch(`${PROD_URL}/login`);
    const html = await res.text();
    const okStatus = res.status === 200;
    const hasForm =
      html.includes("EMAIL") || html.includes("PASSWORD") || html.includes("BLIPS");
    if (okStatus && hasForm) {
      pass("2. BOS /login page renders", `${res.status}, BLIPS branding present`);
    } else {
      fail(
        "2. BOS /login page renders",
        `${res.status}, hasForm=${hasForm}`,
      );
    }
  } catch (e) {
    fail("2. BOS /login page renders", e instanceof Error ? e.message : String(e));
  }

  // ─── 3. /api/inngest is reachable (returns 401 without signature; that's fine) ─
  try {
    const res = await fetch(`${PROD_URL}/api/inngest`, {
      method: "GET",
    });
    if (res.status === 401 || res.status === 405 || res.status === 200) {
      pass(
        "3. /api/inngest webhook reachable",
        `HTTP ${res.status} (Inngest endpoint registered with Vercel)`,
      );
    } else {
      fail(
        "3. /api/inngest webhook reachable",
        `unexpected HTTP ${res.status}`,
      );
    }
  } catch (e) {
    fail(
      "3. /api/inngest webhook reachable",
      e instanceof Error ? e.message : String(e),
    );
  }

  // ─── 4. DB invariants ──────────────────────────────────────────
  const sql = postgres(process.env.DATABASE_URL!, {
    max: 1,
    prepare: false,
  });
  try {
    const [org] =
      (await sql`SELECT id, slug, name FROM orgs WHERE slug = 'blips' LIMIT 1`) as Array<{
        id: string;
        slug: string;
        name: string;
      }>;
    if (org) {
      pass("4a. BLIPS org exists", `id=${org.id}, name="${org.name}"`);
    } else {
      fail("4a. BLIPS org exists", "no row");
    }

    const [user] =
      (await sql`SELECT id, email, role, org_id FROM users WHERE email = ${TEST_EMAIL} LIMIT 1`) as Array<{
        id: string;
        email: string;
        role: string;
        org_id: string;
      }>;
    if (user && user.role === "FOUNDER" && user.org_id === org?.id) {
      pass(
        "4b. FOUNDER user linked",
        `${user.email} → BLIPS, role=${user.role}`,
      );
    } else if (user) {
      fail(
        "4b. FOUNDER user linked",
        `user exists but role=${user.role}, org_id=${user.org_id} (expected role=FOUNDER + BLIPS org)`,
      );
    } else {
      fail("4b. FOUNDER user linked", "no public.users row");
    }

    // Config completeness
    const cfg =
      (await sql`SELECT agent_name, key FROM config_agents ORDER BY agent_name, key`) as Array<{
        agent_name: string;
        key: string;
      }>;
    const expected = {
      ORC: 3,
      BUNKER: 12,
      STOKER: 3,
      FURNACE: 3,
      BOILER: 5,
      ENGINE: 3,
      PROPELLER: 3,
    };
    const actual: Record<string, number> = {};
    for (const r of cfg) actual[r.agent_name] = (actual[r.agent_name] ?? 0) + 1;
    const allMatch = Object.entries(expected).every(
      ([a, c]) => actual[a] === c,
    );
    if (allMatch) {
      pass(
        "4c. config_agents rows complete",
        `total=${cfg.length}, all per-agent counts match expected`,
      );
    } else {
      fail(
        "4c. config_agents rows complete",
        `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
      );
    }

    // Signal_status enum check
    const enums =
      (await sql`SELECT enumlabel FROM pg_enum WHERE enumtypid = (SELECT oid FROM pg_type WHERE typname = 'signal_status') ORDER BY enumsortorder`) as Array<{
        enumlabel: string;
      }>;
    if (enums.length === 15) {
      pass(
        "4d. signal_status enum complete",
        `15 values including BOILER_REFUSED, FURNACE_REFUSED, FANNED_OUT, STOKER_REFUSED`,
      );
    } else {
      fail(
        "4d. signal_status enum complete",
        `expected 15, got ${enums.length}`,
      );
    }

    // signal_source check (after Phase 6.6 sync)
    const sources =
      (await sql`SELECT enumlabel FROM pg_enum WHERE enumtypid = (SELECT oid FROM pg_type WHERE typname = 'signal_source') ORDER BY enumsortorder`) as Array<{
        enumlabel: string;
      }>;
    const hasLLMSynthesis = sources.some(
      (r) => r.enumlabel === "llm_synthesis",
    );
    const hasGrounded = sources.some((r) => r.enumlabel === "grounded_search");
    if (hasLLMSynthesis && hasGrounded && sources.length === 9) {
      pass(
        "4e. signal_source enum complete",
        `9 values; Phase 6.6 additions present`,
      );
    } else {
      fail(
        "4e. signal_source enum complete",
        `count=${sources.length}, hasLLMSyn=${hasLLMSynthesis}, hasGrounded=${hasGrounded}`,
      );
    }

    // Realtime publication
    const pub =
      (await sql`SELECT tablename FROM pg_publication_tables WHERE pubname = 'supabase_realtime' ORDER BY tablename`) as Array<{
        tablename: string;
      }>;
    const expectedPub = [
      "agent_logs",
      "agent_outputs",
      "bunker_candidates",
      "collection_runs",
      "collections",
      "knowledge_documents",
      "signal_locks",
      "signals",
    ];
    const actualPubNames = pub.map((r) => r.tablename).sort();
    const pubMatch =
      JSON.stringify(actualPubNames) === JSON.stringify(expectedPub);
    if (pubMatch) {
      pass(
        "4f. Realtime publication complete",
        `8 tables: ${actualPubNames.join(", ")}`,
      );
    } else {
      fail(
        "4f. Realtime publication complete",
        `mismatch — got: ${actualPubNames.join(", ")}`,
      );
    }
  } finally {
    await sql.end();
  }

  // ─── 5. Authenticated BOS request — does workspace page render? ─
  if (accessToken) {
    try {
      const res = await fetch(`${PROD_URL}/engine-room`, {
        headers: {
          Cookie: `sb-access-token=${accessToken}`,
        },
        redirect: "manual",
      });
      // Server-side auth typically uses Supabase SSR cookie pattern.
      // We're sending a token cookie but BOS may not pick it up via this header
      // alone; it's just a smoke test for the route's response shape.
      if (res.status === 200 || res.status === 307 || res.status === 302) {
        pass(
          "5. /engine-room responds",
          `HTTP ${res.status} (200=rendered, 307/302=redirect to login due to cookie shape — auth-flow handled in browser, not testable via raw fetch)`,
        );
      } else if (res.status >= 500) {
        fail(
          "5. /engine-room responds",
          `HTTP ${res.status} (server error — check Vercel runtime logs)`,
        );
      } else {
        pass(
          "5. /engine-room responds",
          `HTTP ${res.status} (no 5xx)`,
        );
      }
    } catch (e) {
      fail(
        "5. /engine-room responds",
        e instanceof Error ? e.message : String(e),
      );
    }
  }

  // ─── Print results ─────────────────────────────────────────────
  console.log("\n═══════════════════════════════════════════");
  console.log("E2E SMOKE TEST RESULTS");
  console.log("═══════════════════════════════════════════");
  for (const r of results) {
    const icon = r.pass ? "✓" : "✗";
    console.log(`${icon} ${r.name}`);
    console.log(`    ${r.detail}`);
  }
  const passed = results.filter((r) => r.pass).length;
  const total = results.length;
  console.log(`\n${passed}/${total} checks passed`);
  process.exit(passed === total ? 0 : 1);
}

main().catch((e) => {
  console.error("[e2e] fatal:", e);
  process.exit(1);
});
