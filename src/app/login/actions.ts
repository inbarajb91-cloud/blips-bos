"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { checkRateLimit } from "@/lib/api/rate-limit";

export async function signIn(formData: FormData) {
  const email = formData.get("email") as string;
  const password = formData.get("password") as string;

  // REVIEW.md F10 (High): brute-force protection. Supabase Auth has its own
  // rate limits but they're per-project, not per-email — a targeted attack
  // against the founder email could exhaust the project-wide auth quota
  // before the attacker is locked out, causing legitimate logins to fail
  // mid-attack. Stack a per-email limit here (5/min) on top of Supabase's
  // — denied attempts redirect with a friendly message.
  //
  // Email-keyed (not IP-keyed) because the attack surface IS the email
  // address; we don't have a request object in a server action to read
  // x-forwarded-for from anyway. When this moves to a route handler later
  // (per F10 suggestion), add IP-based limit alongside.
  if (email) {
    const rl = checkRateLimit({
      endpoint: "signin",
      identity: email.toLowerCase(),
      limit: 5,
      windowMs: 60_000,
    });
    if (!rl.allowed) {
      redirect(
        `/login?error=${encodeURIComponent(
          `Too many sign-in attempts for this email. Try again in ${Math.ceil(
            rl.retryAfterMs / 1000,
          )}s.`,
        )}`,
      );
    }
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    redirect(`/login?error=${encodeURIComponent(error.message)}`);
  }

  revalidatePath("/", "layout");
  redirect("/");
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  revalidatePath("/", "layout");
  redirect("/login");
}
