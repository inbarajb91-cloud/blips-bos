# API routes

Every handler under `src/app/api/*` is **excluded from the Supabase auth proxy** (`src/proxy.ts`). This is correct — pages use middleware-level auth redirection, API routes use handler-level auth verification. Different failure modes (JSON 401 vs. HTML 302), different auth models (session, signature, API key, public).

## Required auth pattern per route

Every route handler **must** use exactly one of:

### 1. Session-authenticated (browser → our API)

```ts
import { requireSession } from "@/lib/api/auth-helpers";

export async function POST(req: Request) {
  const auth = await requireSession();
  if (auth instanceof NextResponse) return auth; // 401 short-circuit

  // `auth.id`, `auth.email` are now verified Supabase user fields
  ...
}
```

### 2. Signed webhook (third-party service → our API)

The signing library for each service verifies at its own layer. For Inngest:

```ts
import { serve } from "inngest/next";
import { inngest } from "@/lib/inngest/client";
import { functions } from "@/lib/inngest/functions";

// serve() verifies INNGEST_SIGNING_KEY on every request internally.
// Unsigned or tampered requests return 401 before any function runs.
export const { GET, POST, PUT } = serve({ client: inngest, functions });
```

For Stripe, use `stripe.webhooks.constructEvent` with `STRIPE_WEBHOOK_SECRET`. Same pattern — verify at the top, reject early.

### 3. Intentionally public (health checks, etc.)

Mark with a comment containing `PUBLIC_API`:

```ts
// PUBLIC_API: health check, no auth required
export async function GET() {
  return NextResponse.json({ status: "ok" });
}
```

Grepping `PUBLIC_API` across `src/app/api/` surfaces every deliberately-public endpoint — no silent "oops I forgot" routes.

## Why this exists

Before this convention: the Supabase auth proxy protected every route by default, including API routes, which caused it to redirect signed webhooks to `/login` (HTML, breaks the webhook). Phase 5 fixed that by excluding `/api/*` from the proxy. This convention keeps the security posture explicit so "excluded from proxy" doesn't become "accidentally public."

## Reviewing existing routes

| Route | Pattern | Notes |
|---|---|---|
| `/api/inngest` | Signed webhook | `serve()` verifies signing key |
