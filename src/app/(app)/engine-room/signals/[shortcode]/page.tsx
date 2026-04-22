import { and, eq } from "drizzle-orm";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import {
  db,
  signals as signalsTable,
  collections as collectionsTable,
} from "@/db";
import { getCurrentUserWithOrg } from "@/lib/auth/current-user";
import { StagePips, type SignalStatus } from "@/components/engine-room/stage-pips";

export const metadata = { title: "Signal · Engine Room · BLIPS BOS" };

/**
 * Lightweight signal detail page — Phase 6.5.
 *
 * Full workspace (6 agent tabs, ORC conversation, output canvas with
 * per-stage renderers) lands in Phase 7. This page is the "click a
 * pipeline row and see where the signal is" view — shows BUNKER's
 * extracted output and current stage. Nothing more.
 */
export default async function SignalPage({
  params,
}: {
  params: Promise<{ shortcode: string }>;
}) {
  const user = await getCurrentUserWithOrg();
  if (!user) redirect("/login");

  const { shortcode } = await params;
  const decoded = decodeURIComponent(shortcode);

  const [signal] = await db
    .select()
    .from(signalsTable)
    .where(
      and(
        eq(signalsTable.orgId, user.orgId),
        eq(signalsTable.shortcode, decoded),
      ),
    )
    .limit(1);

  if (!signal) notFound();

  // Load the collection the signal came from (if any)
  let collection: typeof collectionsTable.$inferSelect | null = null;
  if (signal.collectionId) {
    const [c] = await db
      .select()
      .from(collectionsTable)
      .where(eq(collectionsTable.id, signal.collectionId))
      .limit(1);
    collection = c ?? null;
  }

  return (
    <div className="w-full max-w-[900px] mx-auto px-6 md:px-10 lg:px-14 pt-12 pb-24">
      <Link
        href="/engine-room"
        className="font-mono text-[10.5px] tracking-[0.22em] uppercase text-t4 hover:text-t1 transition-colors inline-flex items-center gap-2 mb-8"
      >
        &lsaquo; Back to Bridge
      </Link>

      <div
        className={collection ? `t-${collection.type}` : ""}
        style={
          collection
            ? { paddingLeft: "16px", borderLeft: "2px solid rgba(var(--d), 0.55)" }
            : undefined
        }
      >
        <div className="flex items-baseline gap-4 mb-2">
          <span className="font-display font-bold text-[14px] tracking-[0.18em] text-t2">
            {signal.shortcode}
          </span>
          {collection && (
            <span className="font-mono text-[10px] tracking-[0.22em] uppercase text-t5">
              from {collection.name}
            </span>
          )}
        </div>
        <h1 className="font-display font-medium text-[32px] -tracking-[0.015em] leading-tight text-t1 mb-4">
          {signal.workingTitle}
        </h1>
        {signal.concept && (
          <p className="font-editorial italic text-[20px] leading-[1.45] text-t2 max-w-[680px] mb-10">
            &ldquo;{signal.concept}&rdquo;
          </p>
        )}

        <section className="border-t border-rule-1 pt-6 mb-8">
          <div className="font-mono text-[10px] tracking-[0.28em] uppercase text-t5 mb-4">
            Pipeline progress
          </div>
          <StagePips status={signal.status as SignalStatus} size={8} />
          <p className="font-editorial italic text-[14px] text-t4 mt-4 max-w-[520px]">
            {stageExplainer(signal.status as SignalStatus)}
          </p>
        </section>

        <section className="border-t border-rule-1 pt-6 mb-8">
          <div className="font-mono text-[10px] tracking-[0.28em] uppercase text-t5 mb-4">
            Source
          </div>
          <dl className="grid grid-cols-[140px_1fr] gap-y-2.5 gap-x-6 font-mono text-[12px] text-t3">
            <dt className="uppercase tracking-[0.18em] text-t5">Channel</dt>
            <dd className="text-t2">{signal.source}</dd>
            <dt className="uppercase tracking-[0.18em] text-t5">Created</dt>
            <dd className="text-t2">
              {new Date(signal.createdAt).toLocaleString()}
            </dd>
            <dt className="uppercase tracking-[0.18em] text-t5">Updated</dt>
            <dd className="text-t2">
              {new Date(signal.updatedAt).toLocaleString()}
            </dd>
          </dl>
        </section>

        {signal.rawText && (
          <section className="border-t border-rule-1 pt-6 mb-8">
            <div className="font-mono text-[10px] tracking-[0.28em] uppercase text-t5 mb-4">
              Raw source text
            </div>
            <p className="font-editorial text-[14px] leading-[1.65] text-t3 max-w-[680px] whitespace-pre-wrap">
              {signal.rawText.slice(0, 2000)}
              {signal.rawText.length > 2000 && "…"}
            </p>
          </section>
        )}

        <div className="mt-12 border border-dashed border-rule-2 rounded-md p-6">
          <p className="font-editorial italic text-[15px] text-t3 leading-[1.5] max-w-[560px]">
            Full Signal Workspace arrives in Phase 7 — agent tabs, ORC
            conversation, output canvas with per-stage renderers. For now,
            this page shows what BUNKER extracted and where the signal sits
            in the pipeline.
          </p>
        </div>
      </div>
    </div>
  );
}

function stageExplainer(status: SignalStatus): string {
  switch (status) {
    case "IN_BUNKER":
      return "awaiting advancement to STOKER — human gate or auto-trigger will move it forward.";
    case "IN_STOKER":
      return "STOKER is (or will be) manifesting this signal across three decade lenses.";
    case "IN_FURNACE":
      return "FURNACE is scoring brand fit and writing the brief for one of the decade manifestations.";
    case "IN_BOILER":
      return "BOILER is generating concept art and rendering the mockup.";
    case "IN_ENGINE":
      return "ENGINE is producing the tech pack: fabric, measurements, print, trims, packaging, care.";
    case "AT_PROPELLER":
      return "at PROPELLER — vendor bundle ready for production handoff.";
    case "DOCKED":
      return "shipped. this signal became a real product.";
    case "COLD_BUNKER":
      return "parked. paused pending a later decision.";
    case "DISMISSED":
      return "dismissed. kept for audit only.";
    case "BUNKER_FAILED":
    case "EXTRACTION_FAILED":
      return "extraction failed. may need a re-run with a different source.";
    default:
      return "";
  }
}
