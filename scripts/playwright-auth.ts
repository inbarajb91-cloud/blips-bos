/**
 * Sign in via Supabase password grant using the email + password
 * stored in .env.local under keys "Emmail" and "Password" (Inba's
 * naming). Outputs ONLY the cookie name + base64 cookie value that
 * @supabase/ssr expects — the password never enters Claude's context.
 *
 * Usage: npx tsx scripts/playwright-auth.ts
 */

import { existsSync, readFileSync } from "node:fs";

if (existsSync(".env.local")) {
  const envFile = readFileSync(".env.local", "utf-8");
  for (const line of envFile.split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq === -1) continue;
    const k = t.slice(0, eq).trim();
    let raw = t.slice(eq + 1).trim();
    // CR pass 1 fix — strip inline comments. Without this, a line like
    //   API_KEY=abc # this is the prod key
    // would set API_KEY to "abc # this is the prod key" and every
    // subsequent call would fail in confusing ways. Skip stripping
    // when the value is wrapped in quotes (the # might be intentional
    // inside the quoted string).
    const isQuoted = /^["'].*["']$/.test(raw);
    if (!isQuoted) {
      const hashIdx = raw.indexOf(" #");
      if (hashIdx >= 0) raw = raw.slice(0, hashIdx).trim();
    }
    const v = raw.replace(/^["']|["']$/g, "");
    if (!process.env[k]) process.env[k] = v;
  }
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const email = process.env.Emmail;
  const password = process.env.Password;

  if (!url || !anonKey) throw new Error("Missing Supabase URL/anon key");
  if (!email || !password) {
    throw new Error(
      "Missing Emmail or Password env keys. Add them to .env.local.",
    );
  }

  const { createClient } = await import("@supabase/supabase-js");
  const client = createClient(url, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data, error } = await client.auth.signInWithPassword({
    email,
    password,
  });
  if (error || !data.session) {
    throw new Error(
      `signIn failed: ${error?.message ?? "no session"} (status ${error?.status})`,
    );
  }

  const s = data.session;
  const projectRef = new URL(url).host.split(".")[0];
  const cookieName = `sb-${projectRef}-auth-token`;
  const payload = JSON.stringify({
    access_token: s.access_token,
    token_type: s.token_type,
    expires_in: s.expires_in,
    expires_at: s.expires_at,
    refresh_token: s.refresh_token,
    user: s.user,
  });
  const cookieValue = `base64-${Buffer.from(payload, "utf-8").toString("base64")}`;

  // Output only the bits Playwright needs to plant the auth cookie:
  // cookie name + base64 cookie value. Note: the cookieValue itself is
  // a base64-encoded JSON that DOES include the access_token, refresh
  // token, AND the full user object (Supabase's session shape — that's
  // what `@supabase/ssr` expects in the cookie). The password is NOT
  // included anywhere. So this output is sensitive: handle it like any
  // other Supabase access token (write to a temp file with restrictive
  // perms; don't paste into chat / commit / log files).
  console.log(JSON.stringify({ cookieName, cookieValue }));
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
