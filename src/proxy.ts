import { type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

export async function proxy(request: NextRequest) {
  return await updateSession(request);
}

export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - _next/static (static files)
     * - _next/image (image optimization)
     * - api (route handlers manage their own auth — Inngest uses signing key,
     *   future webhooks have their own verification. Without this exclusion,
     *   server-to-server callers get redirected to /login and fail to reach
     *   our endpoints.)
     * - favicon.ico, .png, .svg, .jpg, .jpeg, .gif, .webp (static assets)
     */
    "/((?!_next/static|_next/image|api|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
