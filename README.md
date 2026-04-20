# blips-bos

BLIPS Brand Operating System — the internal platform that powers BLIPS's product design pipeline.

**Status:** Phase 0 → Phase 1 transition. Planning + design complete. Code scaffolding starting.

## What this is

BOS is a web application that runs BLIPS's operations. Its first module, the **Engine Room**, is an AI-powered product design pipeline: cultural signals enter one end, finished products (tech packs, vendor briefs) come out the other.

See the project docs at `/Users/inbaraj/Downloads/Blipsstores/`:
- `CLAUDE.md` — project entry point
- `CONTEXT.md` — current state
- `MEMORY.md` — decision log
- `ARCHITECTURE.md` — technical architecture
- `DESIGN.md` — UI/UX direction (Ink design system)
- `STACK.md` — every tool explained in plain language
- `REVIEWS.md` — post-phase reviews

## Tech stack

- **Frontend:** Next.js + TypeScript on Vercel
- **UI:** shadcn/ui + Tailwind CSS + Framer Motion
- **Data:** Supabase (Postgres + Auth + Realtime)
- **ORM:** Drizzle
- **Validation:** Zod
- **LLM abstraction:** Vercel AI SDK (Anthropic · Gemini · OpenAI swappable)
- **Background jobs:** Inngest
- **Client cache:** TanStack Query

See `STACK.md` for per-tool explanations.

## Local setup

```bash
# Clone
git clone https://github.com/inbarajb91-cloud/blips-bos.git
cd blips-bos

# Copy env template and fill in real values
cp .env.example .env.local

# (After Phase 1 scaffolding — not yet)
npm install
npm run dev
```

## Build phases

See the [Notion project plan](https://www.notion.so/348df0e1f1b581769c60d81213e4f8e3) for the full phase-by-phase build.

Current phase: **Phase 1 — Foundation** (BOS shell + Supabase + Auth).

## Private repo — access

Private repository. Co-built by Inba (founder) and Claude (co-founder).
