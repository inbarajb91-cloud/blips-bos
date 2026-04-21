import { NextResponse } from "next/server";
import type { User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";

/**
 * API route auth helpers.
 *
 * Every API route handler under `/api/*` MUST use one of these three patterns,
 * since `/api/*` is excluded from the Supabase auth proxy (handlers own their
 * auth, not middleware). Violating this convention = accidentally public endpoint.
 *
 * ┌──────────────────────────────┬──────────────────────────────────────────────┐
 * │ Pattern                      │ Use for                                       │
 * ├──────────────────────────────┼──────────────────────────────────────────────┤
 * │ `requireSession()`           │ Browser-originated API calls from authed users │
 * │ Signed webhook (inline)      │ Server-to-server (Inngest, Stripe, GitHub)     │
 * │ `PUBLIC_API` marker comment  │ Intentionally public (health, status)          │
 * └──────────────────────────────┴──────────────────────────────────────────────┘
 *
 * `serve()` from `inngest/next` verifies INNGEST_SIGNING_KEY automatically, so
 * /api/inngest is covered. Future webhook routes (Stripe, Reddit OAuth, etc.)
 * should verify their own provider's signature at the top of the handler.
 */

/**
 * Require an authenticated Supabase session on this API route.
 *
 * Usage:
 *   export async function POST(req: Request) {
 *     const auth = await requireSession();
 *     if (auth instanceof NextResponse) return auth; // 401 short-circuit
 *     // auth.id, auth.email are now safe to use
 *     ...
 *   }
 */
export async function requireSession(): Promise<User | NextResponse> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401 },
    );
  }
  return user;
}

/**
 * Discoverable marker for API routes that are intentionally public.
 *
 * Grepping `PUBLIC_API` across `src/app/api/` yields every deliberately-public
 * endpoint — no silent "I forgot to check auth" endpoints.
 *
 * Usage at the top of a route handler:
 *   // PUBLIC_API: health check, no auth needed
 *   export async function GET() {
 *     return NextResponse.json({ status: "ok" });
 *   }
 */
export const PUBLIC_API_MARKER = "PUBLIC_API" as const;
