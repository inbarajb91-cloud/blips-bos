"use client";

import { useFormStatus } from "react-dom";

/**
 * Log out button — goes inside the UserChip form that calls the signOut server action.
 * Uses useFormStatus to show pending state during sign-out, preventing the
 * "I clicked log out and nothing visible happened" feeling.
 */
export function LogoutButton() {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
      aria-busy={pending}
      className="w-full px-3 py-2.5 rounded-sm font-mono text-[9px] tracking-[0.2em] uppercase text-warm-bright hover:bg-white/[0.03] hover:text-off-white transition-colors text-left cursor-pointer disabled:opacity-70 disabled:cursor-wait focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-off-white focus-visible:ring-inset flex items-center gap-2"
    >
      {pending ? (
        <>
          <span>Logging out</span>
          <span className="inline-flex gap-[3px]">
            <span
              className="w-1 h-1 rounded-full bg-current opacity-60 animate-[pulse_1.4s_ease-in-out_infinite]"
              style={{ animationDelay: "0s" }}
            />
            <span
              className="w-1 h-1 rounded-full bg-current opacity-60 animate-[pulse_1.4s_ease-in-out_infinite]"
              style={{ animationDelay: "0.2s" }}
            />
            <span
              className="w-1 h-1 rounded-full bg-current opacity-60 animate-[pulse_1.4s_ease-in-out_infinite]"
              style={{ animationDelay: "0.4s" }}
            />
          </span>
        </>
      ) : (
        "Log out"
      )}
    </button>
  );
}
