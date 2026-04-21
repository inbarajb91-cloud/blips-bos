import { z } from "zod";
import type { SourceConnector, RawCandidate } from "./types";
import { db, configAgents } from "@/db";
import { and, eq } from "drizzle-orm";
import { generateStructured } from "@/lib/ai/generate";

/**
 * LLM synthesis connector.
 *
 * Instead of pulling from external sources, asks the LLM itself to generate
 * brand-relevant cultural tensions for configured topics. Acts as a fifth
 * source alongside Reddit/RSS/Trends/direct.
 *
 * Per call:
 *   1. Read `llm_synthesis_topics` from config (array of topic strings)
 *   2. Pick 1-2 random topics (rotation keeps outputs varied across runs)
 *   3. For each topic, call Gemini at temp 0.3 with synthesis prompt
 *   4. Parse the structured array response → each item becomes a RawCandidate
 *   5. BUNKER's standard extraction pipeline then processes each
 *
 * Temperature 0.3 = controlled creativity. Temp 0 would just return the
 * most-probable tokens = mainstream discourse = generic output.
 *
 * Cost: ~1 LLM call per topic, 2 topics per run = ~$0.0005 per run on
 * Gemini Flash.
 */

const SYNTHESIS_SYSTEM_PROMPT = `You are BUNKER's LLM synthesis source for BLIPS, a premium philosophical apparel brand.

AUDIENCE: urban English-speaking 28-58, three cohorts (28-38 building career / 38-48 mid-career sandwich generation / 48-58 late career empty-nester). Primary market Chennai India; may expand globally. Indian urban professionals read Western content as native — source lineup is globally blended.

BLIPS DESIGNS name what a decade of life feels like across 7 dimensions: social, musical, cultural, career, responsibilities, expectations, sports. A great signal resonates across multiple dimensions at multiple decade stages.

YOUR JOB
Given a topic area, generate 3-5 cultural tensions that BLIPS could name on a t-shirt. Each tension should be:
- Emotionally charged (a named unspoken thing, not a report)
- Multi-dimensional (touching multiple of the 7 life dimensions)
- Resonant for the 28-58 cohort, Indian + global urban professionals
- Nameable in a short memorable phrase
- A contradiction or paradox, not a trend

Output raw content — title + body paragraph — that BUNKER will then extract (shortcode, working_title, concept) from. Don't pre-extract; write the raw material.

EXAMPLES (target feel):
Topic: "midlife career reckoning"
- Title: "The Competent Paralysis"
  Body: "By 42 you've learned your job so well you could do it in your sleep. That's the problem. The very skill that made you succeed has now become the prison that keeps you from starting over. You're too expert to be a beginner but too exhausted to be an expert anymore."

- Title: "Ambition Inheritance"
  Body: "The drive you felt at 28 came from wanting your parents' validation. Now you're 45 and your parents are aging, and the validation they can still give feels beside the point. But you don't know how to want anything else, because ambition was the only way you knew to live."

AVOID: generic trend reports, consumer buzz, Gen-Z TikTok discourse, pure news, Western-corporate bro framing.

OUTPUT: valid JSON matching the schema exactly. No commentary.`;

const synthesisOutputSchema = z.object({
  candidates: z
    .array(
      z.object({
        title: z
          .string()
          .min(3)
          .max(80)
          .describe(
            "Short evocative title — what BUNKER will read as 'headline'. Not a summary.",
          ),
        body: z
          .string()
          .min(80)
          .max(800)
          .describe(
            "2-4 sentence narrative naming the tension. Multi-dimensional ideally. BUNKER reads this as the 'body' of the source.",
          ),
      }),
    )
    .min(3)
    .max(5),
});

async function readConfigArray(
  orgId: string,
  key: string,
  fallback: string[],
): Promise<string[]> {
  const [row] = await db
    .select({ value: configAgents.value })
    .from(configAgents)
    .where(
      and(
        eq(configAgents.orgId, orgId),
        eq(configAgents.agentName, "BUNKER"),
        eq(configAgents.key, key),
      ),
    );
  if (Array.isArray(row?.value)) return row.value as string[];
  return fallback;
}

async function readConfigNumber(
  orgId: string,
  key: string,
  fallback: number,
): Promise<number> {
  const [row] = await db
    .select({ value: configAgents.value })
    .from(configAgents)
    .where(
      and(
        eq(configAgents.orgId, orgId),
        eq(configAgents.agentName, "BUNKER"),
        eq(configAgents.key, key),
      ),
    );
  if (typeof row?.value === "number") return row.value as number;
  return fallback;
}

function pickRandom<T>(arr: T[], n: number): T[] {
  const copy = [...arr];
  const out: T[] = [];
  for (let i = 0; i < n && copy.length > 0; i++) {
    const idx = Math.floor(Math.random() * copy.length);
    out.push(copy.splice(idx, 1)[0]);
  }
  return out;
}

export const fetchLlmSynthesisCandidates: SourceConnector = async ({
  orgId,
}) => {
  const topics = await readConfigArray(orgId, "llm_synthesis_topics", [
    "midlife career reckoning",
    "urban loneliness at 30+",
  ]);
  const topicsPerRun = await readConfigNumber(
    orgId,
    "llm_synthesis_topics_per_run",
    2,
  );
  const temperature = await readConfigNumber(
    orgId,
    "llm_synthesis_temperature",
    0.3,
  );

  const selected = pickRandom(topics, topicsPerRun);
  const out: RawCandidate[] = [];

  for (const topic of selected) {
    try {
      const result = await generateStructured({
        agentKey: "BUNKER",
        orgId,
        system: SYNTHESIS_SYSTEM_PROMPT,
        prompt: `Topic: "${topic}"\n\nGenerate 3-5 cultural tensions BLIPS could name. Follow the instructions in the system prompt exactly.`,
        schema: synthesisOutputSchema,
        temperature,
      });

      for (const c of result.object.candidates) {
        out.push({
          source: "llm_synthesis",
          title: c.title,
          body: c.body,
          metadata: {
            topic,
            synthesized_by: result.model,
            temperature,
          },
        });
      }
    } catch (e) {
      console.error(
        `[llm-synthesis] topic="${topic}" failed:`,
        (e as Error).message,
      );
      continue;
    }
  }

  return out;
};
