"use client";

import { useCallback, useRef, useState } from "react";
import {
  buildFurnacePrompt,
  furnacePromptFilename,
  type FurnacePromptContent,
  type FurnacePromptContext,
} from "@/lib/furnace-prompt";

/**
 * FURNACE "Download prompt" affordance — Phase 10.5.
 *
 * Two buttons in the FURNACE brief header:
 *   - Download prompt — consolidated brief as a `.md` file
 *   - Copy — same content to the clipboard (what you usually want when
 *     you're about to paste into an external image tool)
 *
 * Pure client-side. The brief content is already in the renderer's
 * props; this builds the markdown string on click via `buildFurnacePrompt`,
 * with no server round-trip. Available in both the review and approved
 * states — you'd want to grab the prompt before approving, too.
 */
export function FurnacePromptDownload({
  content,
  context,
}: {
  content: FurnacePromptContent;
  context: FurnacePromptContext;
}) {
  const [copied, setCopied] = useState(false);
  const copyResetRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleDownload = useCallback(() => {
    const markdown = buildFurnacePrompt(content, context);
    const blob = new Blob([markdown], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = furnacePromptFilename(context.manifestationShortcode);
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    // Revoke on the next tick — revoking synchronously can cancel the
    // download in some browsers before it starts.
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }, [content, context]);

  const handleCopy = useCallback(async () => {
    const markdown = buildFurnacePrompt(content, context);
    try {
      await navigator.clipboard.writeText(markdown);
      setCopied(true);
      if (copyResetRef.current) clearTimeout(copyResetRef.current);
      copyResetRef.current = setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API can reject (permissions, insecure context). Fall
      // back to the download — the user still gets the prompt.
      handleDownload();
    }
  }, [content, context, handleDownload]);

  const btnClass =
    "font-mono text-[10px] tracking-[0.18em] uppercase px-3 py-2 rounded-sm border border-rule-2 text-t3 hover:text-t1 hover:border-rule-3 transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-t2";

  return (
    <div className="flex items-center gap-2 shrink-0">
      <button type="button" onClick={handleCopy} className={btnClass}>
        {copied ? "Copied ✓" : "Copy prompt"}
      </button>
      <button type="button" onClick={handleDownload} className={btnClass}>
        Download prompt
      </button>
    </div>
  );
}
