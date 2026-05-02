"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import {
  archiveKnowledgeDocument,
  createKnowledgeDocument,
  getKnowledgeDocumentVersion,
  restoreKnowledgeDocument,
  rollbackKnowledgeDocument,
  updateKnowledgeDocument,
  type KnowledgeDocFull,
  type KnowledgeDocVersionSummary,
} from "@/lib/actions/knowledge";

/**
 * Knowledge document editor (Phase 8L).
 *
 * Modes:
 *   - 'new'  → create form. On save: createKnowledgeDocument →
 *              redirect to /settings/knowledge/{id}.
 *   - 'edit' → edit form for existing doc. Includes:
 *              - title/content/tags edit
 *              - version history side panel (rollback per version)
 *              - archive toggle
 *              - file upload to replace content
 *
 * Markdown is the canonical format (supermemory's chunker leverages
 * structure). No live preview yet; users write markdown directly into
 * a textarea. Adding a side-by-side preview is a Phase 8L+1 polish if
 * users ask for it.
 */
export function KnowledgeEditor(props: {
  mode: "new" | "edit";
  doc?: KnowledgeDocFull;
  versions?: KnowledgeDocVersionSummary[];
}) {
  const { mode, doc, versions = [] } = props;
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [title, setTitle] = useState(doc?.title ?? "");
  const [content, setContent] = useState(doc?.content ?? "");
  const [tagsRaw, setTagsRaw] = useState((doc?.tags ?? []).join(", "));
  const [changeNote, setChangeNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  function parseTags(): string[] {
    return tagsRaw
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
  }

  function handleSave() {
    setError(null);
    setSuccess(null);
    const t = title.trim();
    const c = content.trim();
    if (t.length < 1 || t.length > 200) {
      setError("Title must be 1-200 characters.");
      return;
    }
    if (c.length < 1) {
      setError("Content can't be empty.");
      return;
    }

    startTransition(async () => {
      try {
        if (mode === "new") {
          const result = await createKnowledgeDocument({
            title: t,
            content: c,
            tags: parseTags(),
            changeNote: changeNote.trim() || undefined,
          });
          router.push(`/settings/knowledge/${result.id}`);
        } else if (doc) {
          await updateKnowledgeDocument({
            documentId: doc.id,
            title: t,
            content: c,
            tags: parseTags(),
            changeNote: changeNote.trim() || undefined,
          });
          setChangeNote("");
          setSuccess("Saved. ORC will see the new version on next recall.");
          router.refresh();
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : "Save failed.");
      }
    });
  }

  function handleArchive() {
    if (!doc) return;
    if (
      !confirm(
        "Archive this knowledge document? It'll stop appearing in ORC's recall until restored.",
      )
    ) {
      return;
    }
    startTransition(async () => {
      try {
        await archiveKnowledgeDocument(doc.id);
        router.push("/settings/knowledge");
      } catch (e) {
        setError(e instanceof Error ? e.message : "Archive failed.");
      }
    });
  }

  function handleRestore() {
    if (!doc) return;
    startTransition(async () => {
      try {
        await restoreKnowledgeDocument(doc.id);
        setSuccess("Restored. ORC can recall this doc again.");
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Restore failed.");
      }
    });
  }

  function handleRollback(toVersion: number) {
    if (!doc) return;
    if (
      !confirm(
        `Roll back to version ${toVersion}? This creates a new version with the old content (history is preserved).`,
      )
    ) {
      return;
    }
    startTransition(async () => {
      try {
        await rollbackKnowledgeDocument({
          documentId: doc.id,
          toVersion,
        });
        setSuccess(`Rolled back to v${toVersion}. New version created.`);
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Rollback failed.");
      }
    });
  }

  function handleViewVersion(version: number) {
    if (!doc) return;
    startTransition(async () => {
      try {
        const v = await getKnowledgeDocumentVersion(doc.id, version);
        if (!v) {
          setError(`Version ${version} not found.`);
          return;
        }
        setTitle(v.title);
        setContent(v.content);
        setTagsRaw(v.tags.join(", "));
        setSuccess(
          `Loaded v${version} into the editor. Click Save to commit as a new version, or navigate away to discard.`,
        );
      } catch (e) {
        setError(e instanceof Error ? e.message : "Load version failed.");
      }
    });
  }

  function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".md")) {
      setError("Only .md files are supported.");
      return;
    }
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = String(ev.target?.result ?? "");
      // Pre-fill the editor with the file content. If the user is in
      // 'new' mode and title is still empty, derive a title from the
      // filename or first H1.
      setContent(text);
      if (mode === "new" && title.trim().length === 0) {
        const h1Match = text.match(/^#\s+(.+)$/m);
        const derived = h1Match
          ? h1Match[1].trim()
          : file.name.replace(/\.md$/i, "");
        setTitle(derived.slice(0, 200));
      }
    };
    reader.readAsText(file);
    // Reset so re-selecting the same file re-fires onChange.
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[1fr_280px] gap-8">
      {/* Editor column */}
      <div>
        {/* Header */}
        <div className="flex items-start justify-between gap-6 mb-6">
          <div>
            <Link
              href="/settings/knowledge"
              className="font-mono text-[10px] uppercase tracking-[0.18em] text-warm-muted hover:text-off-white transition-colors"
            >
              ← Knowledge
            </Link>
            <h1 className="font-display text-xl font-semibold mt-1">
              {mode === "new" ? "New knowledge document" : "Edit document"}
            </h1>
            {doc && (
              <p className="font-mono text-[11px] text-warm-muted mt-1">
                v{doc.currentVersion} · created{" "}
                {new Date(doc.createdAt).toLocaleDateString("en-US")} ·{" "}
                {doc.status === "archived" ? "archived" : "active"}
              </p>
            )}
          </div>
          <div className="flex items-center gap-3">
            <input
              ref={fileInputRef}
              type="file"
              accept=".md"
              onChange={handleFileUpload}
              className="hidden"
              id="knowledge-file-upload"
            />
            <label
              htmlFor="knowledge-file-upload"
              className="font-mono text-[10px] uppercase tracking-[0.18em] text-warm-muted hover:text-off-white transition-colors cursor-pointer"
            >
              Upload .md
            </label>
            {doc && doc.status === "active" && (
              <button
                type="button"
                onClick={handleArchive}
                disabled={pending}
                className="font-mono text-[10px] uppercase tracking-[0.18em] text-warm-muted hover:text-off-white transition-colors disabled:opacity-50"
              >
                Archive
              </button>
            )}
            {doc && doc.status === "archived" && (
              <button
                type="button"
                onClick={handleRestore}
                disabled={pending}
                className="font-mono text-[10px] uppercase tracking-[0.18em] text-warm-muted hover:text-off-white transition-colors disabled:opacity-50"
              >
                Restore
              </button>
            )}
          </div>
        </div>

        {/* Title */}
        <label className="block mb-4">
          <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-warm-muted block mb-2">
            Title
          </span>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. RCK Decade Playbook"
            maxLength={200}
            className="w-full bg-ink-warm border border-deep-divider rounded-sm px-3 py-2.5 font-display text-base text-off-white placeholder:text-warm-muted focus-visible:outline-none focus-visible:border-warm-bright"
          />
        </label>

        {/* Tags */}
        <label className="block mb-4">
          <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-warm-muted block mb-2">
            Tags <span className="text-warm-muted/60">(comma-separated)</span>
          </span>
          <input
            type="text"
            value={tagsRaw}
            onChange={(e) => setTagsRaw(e.target.value)}
            placeholder="e.g. voice, decade, strategy"
            className="w-full bg-ink-warm border border-deep-divider rounded-sm px-3 py-2 font-mono text-[12px] text-off-white placeholder:text-warm-muted focus-visible:outline-none focus-visible:border-warm-bright"
          />
        </label>

        {/* Content */}
        <label className="block mb-4">
          <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-warm-muted block mb-2">
            Content (markdown)
          </span>
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder={
              "# RCK Decade Playbook\n\n## What motivates Reckoning-cohort buyers\n\n- ..."
            }
            rows={24}
            className="w-full bg-ink-warm border border-deep-divider rounded-sm px-3 py-3 font-mono text-[12.5px] leading-[1.6] text-off-white placeholder:text-warm-muted focus-visible:outline-none focus-visible:border-warm-bright resize-vertical"
          />
        </label>

        {/* Change note */}
        <label className="block mb-6">
          <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-warm-muted block mb-2">
            Change note <span className="text-warm-muted/60">(optional)</span>
          </span>
          <input
            type="text"
            value={changeNote}
            onChange={(e) => setChangeNote(e.target.value)}
            placeholder="e.g. Refined RCD tone after Q3 review"
            className="w-full bg-ink-warm border border-deep-divider rounded-sm px-3 py-2 font-mono text-[11px] text-off-white placeholder:text-warm-muted focus-visible:outline-none focus-visible:border-warm-bright"
          />
        </label>

        {/* Status messages */}
        {error && (
          <p
            role="alert"
            className="font-mono text-[11px] text-[#d4908a] mb-4 leading-relaxed"
          >
            {error}
          </p>
        )}
        {success && (
          <p className="font-mono text-[11px] text-warm-bright mb-4 leading-relaxed">
            {success}
          </p>
        )}

        {/* Save */}
        <button
          type="button"
          onClick={handleSave}
          disabled={pending}
          className="font-mono text-[11px] uppercase tracking-[0.18em] px-6 py-2.5 bg-off-white text-ink hover:bg-warm-bright transition-colors rounded-sm disabled:opacity-50"
        >
          {pending ? "Saving…" : mode === "new" ? "Create document" : "Save changes"}
        </button>
      </div>

      {/* Version history side panel (edit mode only) */}
      {mode === "edit" && doc && (
        <aside className="lg:border-l lg:border-deep-divider lg:pl-6">
          <h2 className="font-mono text-[10px] uppercase tracking-[0.2em] text-warm-muted mb-4">
            Version history
          </h2>
          {versions.length === 0 ? (
            <p className="font-editorial text-warm-muted text-sm">
              No versions yet.
            </p>
          ) : (
            <ul className="flex flex-col gap-3">
              {versions.map((v) => (
                <li
                  key={v.id}
                  className="border border-deep-divider rounded-sm p-3"
                >
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <span className="font-display text-sm text-off-white font-medium">
                      v{v.version}
                    </span>
                    <span className="font-mono text-[10px] text-warm-muted">
                      {new Date(v.editedAt).toLocaleDateString("en-US", {
                        month: "short",
                        day: "numeric",
                      })}
                    </span>
                  </div>
                  <p className="font-mono text-[11px] text-warm-bright leading-relaxed truncate">
                    {v.title}
                  </p>
                  {v.changeNote && (
                    <p className="font-editorial text-warm-muted text-[12px] mt-1 leading-relaxed">
                      {v.changeNote}
                    </p>
                  )}
                  <div className="flex items-center gap-3 mt-2">
                    <button
                      type="button"
                      onClick={() => handleViewVersion(v.version)}
                      disabled={pending}
                      className="font-mono text-[9px] uppercase tracking-[0.18em] text-warm-muted hover:text-off-white transition-colors disabled:opacity-50"
                    >
                      Load
                    </button>
                    {v.version !== doc.currentVersion && (
                      <button
                        type="button"
                        onClick={() => handleRollback(v.version)}
                        disabled={pending}
                        className="font-mono text-[9px] uppercase tracking-[0.18em] text-warm-muted hover:text-off-white transition-colors disabled:opacity-50"
                      >
                        Roll back
                      </button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </aside>
      )}
    </div>
  );
}
