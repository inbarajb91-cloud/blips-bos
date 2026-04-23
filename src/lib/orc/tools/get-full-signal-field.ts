import { tool } from "ai";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { db, signals } from "@/db";
import type { OrcToolContext } from "./types";

/**
 * get_full_signal_field — fetches a specific large field from the
 * current signal on demand. ORC's context builder ships only a
 * compact signal core (shortcode/title/concept/source + 300-char raw
 * excerpt) to keep the stable prefix under budget; anything larger is
 * accessible via this tool.
 *
 * Allowed fields are a closed set — arbitrary field names would let
 * the model query scoping fields like `org_id` or timestamps, which
 * it doesn't need and shouldn't see.
 */

const ALLOWED_FIELDS = [
  "raw_text",
  "raw_metadata",
  "source_url",
  "working_title",
  "concept",
  "source",
  "status",
  "shortcode",
  "created_at",
  "updated_at",
] as const;

export function getFullSignalField(ctx: OrcToolContext) {
  return tool({
    description:
      "Fetch a specific field from the current signal when the context preview is not enough. Use for `raw_text` (full raw excerpt), `raw_metadata` (full source dossier), `source_url` (link to original), etc.",
    inputSchema: z.object({
      field: z.enum(ALLOWED_FIELDS).describe("Which field to fetch"),
    }),
    execute: async ({ field }) => {
      const [row] = await db
        .select()
        .from(signals)
        .where(and(eq(signals.id, ctx.signalId), eq(signals.orgId, ctx.orgId)))
        .limit(1);
      if (!row) throw new Error("Signal not found");

      // Map snake_case field names to the camelCase column names on
      // the returned row. The enum's snake_case flavor is the one
      // that matches the DB + raw_metadata JSON keys ORC sees
      // elsewhere, so keeping it as the tool's input vocabulary is
      // the most consistent shape for the model.
      const fieldMap: Record<(typeof ALLOWED_FIELDS)[number], unknown> = {
        raw_text: row.rawText,
        raw_metadata: row.rawMetadata,
        source_url:
          row.rawMetadata && typeof row.rawMetadata === "object"
            ? (row.rawMetadata as Record<string, unknown>).url ??
              (row.rawMetadata as Record<string, unknown>).source_url ??
              null
            : null,
        working_title: row.workingTitle,
        concept: row.concept,
        source: row.source,
        status: row.status,
        shortcode: row.shortcode,
        created_at: row.createdAt.toISOString(),
        updated_at: row.updatedAt.toISOString(),
      };

      return {
        field,
        value: fieldMap[field],
      };
    },
  });
}
