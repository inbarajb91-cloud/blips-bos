# blips-bos

BLIPS Brand Operating System — the internal platform that powers BLIPS's product design pipeline.

**Status:** Phases 1–8 shipped to production (conversational ORC + cross-signal long-term memory). Phase 8K (stage-completion memory hook) shipping next on this branch.

## What this is

BOS is a web application that runs BLIPS's operations. Its first module, the **Engine Room**, is an AI-powered product design pipeline: cultural signals enter one end, finished products (tech packs, vendor briefs) come out the other.

Project docs (CLAUDE.md / CONTEXT.md / MEMORY.md / ARCHITECTURE.md / DESIGN.md / STACK.md / REVIEWS.md) live in the team's internal workspace, mirrored to Google Drive `BOS/DEVELOPMENT/`. The Notion build plan ([BLIPS — BOS Build Project](https://www.notion.so/348df0e1f1b581769c60d81213e4f8e3)) carries the phase-by-phase build narrative.

> REVIEW.md F29 (Low): this section used to list absolute paths on one machine. New contributors clone and the paths don't resolve. Replaced with the Notion link + Drive-mirror note.

## Tech stack

- **Frontend:** Next.js + TypeScript on Vercel
- **UI:** shadcn/ui + Tailwind CSS + Framer Motion
- **Data:** Supabase (Postgres + Auth + Realtime)
- **ORM:** Drizzle
- **Validation:** Zod
- **LLM abstraction:** Vercel AI SDK (Anthropic · Gemini · OpenAI swappable)
- **Background jobs:** Inngest
- **Client cache:** TanStack Query
- **Long-term memory (Phase 8K+):** Supermemory hosted (behind swappable `MemoryBackend` interface — pg_vector available as fallback)

See `STACK.md` for per-tool explanations.

## Local setup

```bash
# Clone
git clone https://github.com/Blips-Development/blips-bos.git
cd blips-bos

# Copy env template and fill in real values
cp .env.example .env.local

# Install (pnpm only — package.json's preinstall hook refuses npm/yarn).
# If you don't have pnpm yet: corepack enable && corepack prepare pnpm@9 --activate
pnpm install
pnpm run dev
```

## Build phases

See the [Notion project plan](https://www.notion.so/348df0e1f1b581769c60d81213e4f8e3) for the full phase-by-phase build.

Phases 1–8 shipped to main and live in production. Phase 8 (Conversational ORC + Memory Layer) merged April 27 as `e6455d9`. This PR ships **Phase 8K stage-completion hook** — orchestrator writes a memory row to the `events` container after each agent_outputs insert so ORC can later recall stage-level patterns across signals. Next on the queue: Phase 8L curated knowledge UI, Phase 8M proactive surfacing.

## Private repo — access

Private repository. Co-built by Inba (founder) and Claude (co-founder).
