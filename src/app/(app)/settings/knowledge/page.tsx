import Link from "next/link";
import { listKnowledgeDocuments } from "@/lib/actions/knowledge";

export const metadata = { title: "Knowledge · BOS Settings · BLIPS" };

/**
 * Knowledge layer — list view (Phase 8L).
 *
 * Founder-only. Server-component rendered list of all curated docs
 * with title, tags, last-edited timestamp, and archive status. Click
 * a row to open the editor; click "New document" to create.
 *
 * Auth gate: listKnowledgeDocuments() calls requireFounder() which
 * throws on non-founder. The throw propagates as a server-component
 * error, caught by the nearest error.tsx (or Next's default error
 * page). No client-side role check needed.
 */
export default async function KnowledgeListPage({
  searchParams,
}: {
  searchParams?: Promise<{ status?: string }>;
}) {
  const params = (await searchParams) ?? {};
  const showArchived = params.status === "archived";
  const docs = await listKnowledgeDocuments({
    status: showArchived ? "archived" : "active",
  });

  return (
    <div className="max-w-6xl mx-auto px-6 md:px-10 pt-10 pb-16">
      <div className="flex items-start justify-between gap-6 mb-2">
        <div>
          <h1 className="font-display text-2xl font-semibold">Knowledge</h1>
          <p className="font-mono text-xs text-warm-muted mt-1 leading-relaxed">
            Curated reference docs ORC reads.{" "}
            {showArchived ? "Archived" : "Active"} · {docs.length}{" "}
            {docs.length === 1 ? "doc" : "docs"}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Link
            href={
              showArchived
                ? "/settings/knowledge"
                : "/settings/knowledge?status=archived"
            }
            className="font-mono text-[10px] uppercase tracking-[0.18em] text-warm-muted hover:text-off-white transition-colors"
          >
            {showArchived ? "Active" : "Archived"}
          </Link>
          <Link
            href="/settings/knowledge/new"
            className="font-mono text-[11px] uppercase tracking-[0.18em] px-4 py-2 border border-off-white text-off-white hover:bg-off-white hover:text-ink transition-colors rounded-sm"
          >
            New document
          </Link>
        </div>
      </div>

      <p className="font-editorial italic text-warm-muted text-sm mb-8">
        ORC reads from these via{" "}
        <code className="font-mono text-[11px] text-warm-bright">
          recall(query, container=&apos;knowledge&apos;)
        </code>
        . Markdown headings + lists help its chunker keep related facts
        together.
      </p>

      {docs.length === 0 ? (
        <div className="border border-dashed border-deep-divider rounded-md py-16 px-6 text-center">
          <p className="font-editorial italic text-warm-bright text-base mb-2">
            {showArchived
              ? "No archived knowledge docs yet."
              : "No knowledge docs yet."}
          </p>
          {!showArchived && (
            <p className="font-mono text-[11px] text-warm-muted">
              Start with a Voice Guidelines doc, a Decade Playbook
              (RCK/RCL/RCD), or BLIPS strategic principles. Click{" "}
              <span className="text-warm-bright">New document</span> above.
            </p>
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-px border border-deep-divider rounded-md overflow-hidden">
          {docs.map((d) => (
            <Link
              key={d.id}
              href={`/settings/knowledge/${d.id}`}
              className="bg-ink px-5 py-5 border-b border-deep-divider last:border-b-0 transition-colors hover:bg-ink-warm focus-visible:outline-none focus-visible:bg-ink-warm flex items-start justify-between gap-6"
            >
              <div className="flex flex-col gap-1.5 min-w-0">
                <span className="font-display text-sm font-medium text-off-white truncate">
                  {d.title}
                </span>
                <div className="flex items-center gap-2 flex-wrap">
                  {d.tags.map((t) => (
                    <span
                      key={t}
                      className="font-mono text-[9px] uppercase tracking-[0.18em] text-warm-muted px-1.5 py-0.5 border border-deep-divider rounded-sm"
                    >
                      {t}
                    </span>
                  ))}
                  <span className="font-mono text-[10px] text-warm-muted">
                    v{d.currentVersion} · updated{" "}
                    {new Date(d.updatedAt).toLocaleDateString("en-US", {
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                    })}
                  </span>
                </div>
              </div>
              <span className="font-mono text-[9px] uppercase tracking-[0.2em] text-warm-muted whitespace-nowrap mt-1">
                Open
              </span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
