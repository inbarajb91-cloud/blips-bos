"use client";

import { useFormStatus } from "react-dom";

export function SubmitButton() {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
      aria-busy={pending}
      className="mt-2 bg-off-white text-ink font-mono text-sm uppercase tracking-[0.15em] py-2.5 rounded-md hover:bg-warm-bright transition-colors disabled:opacity-70 disabled:cursor-wait flex items-center justify-center gap-2"
    >
      {pending ? (
        <>
          <span>Entering</span>
          <span className="inline-flex gap-[3px]">
            <span className="w-1 h-1 rounded-full bg-ink/60 animate-[pulse_1.4s_ease-in-out_infinite]" />
            <span
              className="w-1 h-1 rounded-full bg-ink/60 animate-[pulse_1.4s_ease-in-out_0.2s_infinite]"
              style={{ animationDelay: "0.2s" }}
            />
            <span
              className="w-1 h-1 rounded-full bg-ink/60 animate-[pulse_1.4s_ease-in-out_0.4s_infinite]"
              style={{ animationDelay: "0.4s" }}
            />
          </span>
        </>
      ) : (
        "Enter"
      )}
    </button>
  );
}
