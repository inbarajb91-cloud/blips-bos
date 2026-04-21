/**
 * BUNKER eval suite — Phase 6 acceptance test.
 *
 * Per PRD v2.1: 13 of 15 cases must pass for BUNKER to formally ship.
 *
 * Each case runs BUNKER's extraction path (same generateStructured call
 * real sources use) against a fixture input, then checks the output
 * against hard criteria:
 *
 *   - Output must match Zod schema (no exception)
 *   - shortcode matches /^[A-Z]{3,6}$/
 *   - working_title length 1-40 chars
 *   - concept length 10-300 chars
 *   - source_context length 1-200 chars
 *
 * Soft criteria (reported but not blocking):
 *   - Shortcode is pronounceable (contains at least one vowel)
 *   - Concept names a tension (contains a contrast/contradiction word)
 *
 * Cost: 15 × ~$0.0001 Gemini 2.5 Flash calls = <$0.01 per run.
 *
 * Usage: npx tsx scripts/bunker-evals.ts
 */

import { readFileSync } from "node:fs";

const envFile = readFileSync(".env.local", "utf-8");
for (const line of envFile.split("\n")) {
  const t = line.trim();
  if (!t || t.startsWith("#")) continue;
  const eq = t.indexOf("=");
  if (eq === -1) continue;
  const k = t.slice(0, eq).trim();
  const v = t.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
  if (!process.env[k]) process.env[k] = v;
}

interface EvalCase {
  id: string;
  description: string;
  input: {
    source: "direct" | "reddit" | "rss" | "trends" | "newsapi" | "upload" | "llm_synthesis";
    title: string;
    body: string;
    url?: string;
    metadata?: Record<string, unknown>;
  };
}

const EVAL_CASES: EvalCase[] = [
  {
    id: "e01_burnout_article",
    description: "Global burnout essay — universal tension",
    input: {
      source: "rss",
      title: "We Aren't Lazy, We're Exhausted",
      body: "The question isn't why people are quitting. The question is why we kept going so long. For a generation raised to equate worth with work, exhaustion isn't a symptom — it's an indictment of the bargain. The industriousness that felt like virtue at 25 looks like martyrdom at 45, and the silent quit is less a revolution than a small, long-delayed act of self-preservation.",
    },
  },
  {
    id: "e02_sandwich_generation",
    description: "Indian sandwich generation — caregiver caught between kids + parents",
    input: {
      source: "rss",
      title: "The Indian 40-Year-Old's Impossible Calculus",
      body: "At 42, she is a parent to two teenagers and a parent to two parents. Her WhatsApp is alternately her son asking for the wifi password and her father asking why his Aadhaar app isn't working. Both questions arrive at 11 PM. Both require the same exhausted patience. She wonders when she stopped being anyone's child and started being everyone's helpline.",
    },
  },
  {
    id: "e03_cricket_nostalgia",
    description: "Cricket across decades — sports + memory + family",
    input: {
      source: "direct",
      title: "My Father Taught Me Cricket At 8",
      body: "My father taught me the lbw rule when I was eight years old, standing in our Mylapore driveway with a tennis ball that had already lost its fuzz. I taught my son the lbw rule last Sunday. The rule has not changed. The driveway has changed. My father has changed. My son asked why anyone cares about cricket, and I couldn't explain it without explaining my father, and I don't know how to do that.",
    },
  },
  {
    id: "e04_revenge_bedtime",
    description: "Revenge bedtime procrastination — universal rest rebellion",
    input: {
      source: "reddit",
      title: "Anyone else stay up doomscrolling until 2 AM just to feel like the day was yours?",
      body: "This is going to sound pathetic but: I have a good job, a loving family, a life people would envy, and yet I cannot go to sleep before 1 AM. I'm scrolling, I'm watching videos I won't remember tomorrow, I'm doing nothing productive. My partner calls it self-destruction. I call it the only time that feels like mine. Is this a thing for anyone else?",
      metadata: { subreddit: "AskMenOver30", upvotes: 847 },
    },
  },
  {
    id: "e05_nri_guilt",
    description: "NRI guilt — staying-leaving tension",
    input: {
      source: "rss",
      title: "The Call From Home",
      body: "She took the call in the San Francisco afternoon. It was 3 AM in Chennai. Her mother was crying about something ordinary — the maid hadn't shown up, a neighbor had been rude. The kind of thing that would have lasted ten minutes in person. On the phone, across 13,500 kilometers, it stretched to forty. Her mother wasn't really crying about the maid. She was crying about being 67 in a house her daughter had visited twice in five years. She hung up and opened her 401k statement to remind herself why.",
    },
  },
  {
    id: "e06_digital_ambivalence",
    description: "Digital ambivalence — built the internet, regret giving it to kids",
    input: {
      source: "rss",
      title: "I Built This Internet and I Don't Want My Kids On It",
      body: "I was in the first wave that believed the web would make us smarter, freer, more connected. I was wrong in ways I couldn't have predicted at 25. Now I'm 44 and my daughter is 11 and every debate I have with her about screen time is a debate with my own past self. The version of me who built early-2000s community forums wouldn't recognize the thing TikTok is doing to her attention. I am a refugee from my own invention.",
    },
  },
  {
    id: "e07_quiet_quitting_india",
    description: "Quiet quitting in Indian corporate — specific cultural texture",
    input: {
      source: "reddit",
      title: "10 years at this Bangalore company. I've been checked out for 3.",
      body: "I show up. I hit my numbers. I attend the meetings where I say nothing and leave the ones where I say nothing. My manager gave me an 'exceeds expectations' this quarter. I am exceeding expectations of a version of my job I stopped caring about in 2023. The company tried to bring back WFO — I went back to WFO. The company rolled out wellness week — I sat through wellness week. I am a perfect employee of a career I don't want. My parents keep asking when I'll get promoted.",
      metadata: { subreddit: "IndianWorkplace", upvotes: 2100 },
    },
  },
  {
    id: "e08_midlife_pivot",
    description: "Career pivot at 45 — ambition question",
    input: {
      source: "rss",
      title: "I Quit The Job I Spent 20 Years Earning",
      body: "The promotion was the prize I had been told to want since my first internship at 22. When it arrived at 43, I opened the email in a hotel bathroom in Gurgaon because I couldn't let my team see my face. It wasn't joy. It was the private recognition that the ladder had always been a shorter one than advertised, and I was now at the top of a ladder leaning against the wrong wall. I gave my notice three weeks later. My mother has not forgiven me.",
    },
  },
  {
    id: "e09_music_nostalgia",
    description: "Music nostalgia — songs cool at 17, shameful at 37",
    input: {
      source: "rss",
      title: "The Songs We Are No Longer Allowed To Love",
      body: "There is a specific cruelty to aging through music. Songs that were life-affirming at 17 become embarrassing at 27 and then, by 37, they quietly return — not as things you love again but as things you allow yourself to love in secret. The 2000s radio hits I would have died defending at 20 now live exclusively in the car, volume down when someone else gets in. Who decides when a song has aged poorly? Us. We do. We do it to ourselves.",
    },
  },
  {
    id: "e10_urban_loneliness",
    description: "Urban loneliness at 34 — friendships thinning",
    input: {
      source: "direct",
      title: "I Have Many Contacts And Zero Friends",
      body: "I am 34. My phone contains 847 contacts. I speak regularly to my parents, my partner, and a coworker I would call a friend but haven't seen in two years. The others are artifacts — former colleagues, old college friends whose kids I have only seen in photos, people from a life I stopped participating in at some point without deciding to. Making new friends at this age feels like starting a new religion. Nobody warns you.",
    },
  },
  {
    id: "e11_empty_nest",
    description: "Empty nest at 52 — late cohort reckoning",
    input: {
      source: "rss",
      title: "The House Got Loud In A New Way When She Left",
      body: "We dropped her at the university in Delhi and came home to a house in Adyar that was suddenly, unmistakably too large. I expected silence. What I didn't expect was how loud the silence would be — every room now reporting the precise shape of her absence. My wife put her phone down on the dining table and said, quietly, 'What are we for now?' I don't have a job-shaped answer for that question. I thought I would.",
    },
  },
  {
    id: "e12_ambition_inheritance",
    description: "Ambition inheritance — drive that came from parents, now they're aging",
    input: {
      source: "llm_synthesis",
      title: "Ambition Inheritance",
      body: "The drive you felt at 28 came from wanting your parents' validation. Now you're 45 and your parents are aging, and the validation they can still give feels beside the point. But you don't know how to want anything else, because ambition was the only way you knew to live. You are running a race whose finishing line your coaches no longer remember.",
      metadata: { topic: "midlife career reckoning", synthesized_by: "gemini-2.5-flash" },
    },
  },
  {
    id: "e13_short_fragment",
    description: "Minimal body — tests BUNKER's resilience to thin input",
    input: {
      source: "direct",
      title: "Sunday night dread",
      body: "Sunday night dread never left me. I'm 41. I have my own company. I set my own hours. It is still there, every Sunday night, and I don't know who it's afraid of anymore.",
    },
  },
  {
    id: "e14_parenting_screens",
    description: "Parenting in attention economy — responsibilities + culture",
    input: {
      source: "rss",
      title: "I Am Not Losing My Son To TikTok, I Am Losing Him To The Feeling Of Being Known",
      body: "Every parenting article treats the app as the problem. The app is not the problem. The app is very good at the problem — which is that my 13-year-old needs, as all 13-year-olds have always needed, to feel seen by someone who isn't a parent. The scroll gives him a version of that feeling, calibrated every 30 seconds. I am competing with an algorithm that knows him better than I do in a measurable sense. I don't know how to win this one. I'm not sure there's a version of winning.",
    },
  },
  {
    id: "e15_generic_news",
    description: "Generic consumer trend — BUNKER should still extract valid schema, but concept will be weaker (tests robustness, not brand quality)",
    input: {
      source: "trends",
      title: "Matcha sales surge in India as health trends continue",
      body: "Premium matcha products have seen a 340% year-over-year increase in India, driven by urban millennials seeking alternatives to traditional chai. Specialty cafes in Bengaluru, Mumbai, and Delhi now offer matcha lattes at price points comparable to Western markets. Analysts project continued growth through 2026.",
      metadata: { geo: "IN", trending_since: "2026-04-15" },
    },
  },
];

const SHORTCODE_REGEX = /^[A-Z]{3,6}$/;
const PRONOUNCEABLE_REGEX = /[AEIOU]/i;
const TENSION_WORDS = [
  "while",
  "but",
  "yet",
  "despite",
  "even though",
  "paradox",
  "contradiction",
  "tension",
  "against",
  "without",
  "still",
  "no longer",
  "used to",
  "instead",
  "not really",
  "unable",
];

interface EvalResult {
  id: string;
  description: string;
  passed: boolean;
  hardCriteria: {
    schemaValid: boolean;
    shortcodeRegex: boolean;
    workingTitleLength: boolean;
    conceptLength: boolean;
    sourceContextLength: boolean;
  };
  softCriteria: {
    pronounceable: boolean;
    namesTension: boolean;
  };
  output?: {
    shortcode: string;
    working_title: string;
    concept: string;
  };
  error?: string;
  model?: string;
  fallbacksUsed?: number;
  durationMs?: number;
}

async function runEval(
  caseDef: EvalCase,
  orgId: string,
): Promise<EvalResult> {
  const { generateStructured } = await import("../src/lib/ai/generate");
  const { bunkerSkill } = await import("../src/skills/bunker");

  const base: EvalResult = {
    id: caseDef.id,
    description: caseDef.description,
    passed: false,
    hardCriteria: {
      schemaValid: false,
      shortcodeRegex: false,
      workingTitleLength: false,
      conceptLength: false,
      sourceContextLength: false,
    },
    softCriteria: {
      pronounceable: false,
      namesTension: false,
    },
  };

  try {
    const result = await generateStructured({
      agentKey: "BUNKER",
      orgId,
      system: bunkerSkill.systemPrompt,
      prompt: bunkerSkill.buildPrompt(
        bunkerSkill.inputSchema.parse(caseDef.input),
      ),
      schema: bunkerSkill.outputSchema,
    });

    // Schema validation happens in generateStructured; reaching here = schema valid
    base.hardCriteria.schemaValid = true;

    const out = result.object;
    base.output = {
      shortcode: out.shortcode,
      working_title: out.working_title,
      concept: out.concept,
    };
    base.model = result.model;
    base.fallbacksUsed = result.fallbacksUsed;
    base.durationMs = result.durationMs;

    // Hard criteria checks
    base.hardCriteria.shortcodeRegex = SHORTCODE_REGEX.test(out.shortcode);
    base.hardCriteria.workingTitleLength =
      out.working_title.length >= 1 && out.working_title.length <= 40;
    base.hardCriteria.conceptLength =
      out.concept.length >= 10 && out.concept.length <= 300;
    base.hardCriteria.sourceContextLength =
      out.source_context.length >= 1 && out.source_context.length <= 200;

    // Soft criteria
    base.softCriteria.pronounceable = PRONOUNCEABLE_REGEX.test(out.shortcode);
    const conceptLower = out.concept.toLowerCase();
    base.softCriteria.namesTension = TENSION_WORDS.some((w) =>
      conceptLower.includes(w),
    );

    // Overall pass = all hard criteria pass
    base.passed = Object.values(base.hardCriteria).every((v) => v === true);
  } catch (e) {
    base.error = (e as Error).message;
  }

  return base;
}

async function main() {
  const { eq } = await import("drizzle-orm");
  const { db } = await import("../src/db");
  const { orgs } = await import("../src/db/schema");

  const [org] = await db.select().from(orgs).where(eq(orgs.slug, "blips"));
  if (!org) {
    console.error("✗ No BLIPS org. Run scripts/seed.ts first.");
    process.exit(1);
  }
  console.log(`✓ Org: ${org.name}`);
  console.log(`→ Running ${EVAL_CASES.length} BUNKER eval cases...\n`);

  const results: EvalResult[] = [];
  for (const c of EVAL_CASES) {
    process.stdout.write(`  ${c.id.padEnd(32)} `);
    const r = await runEval(c, org.id);
    results.push(r);
    if (r.passed) {
      const marks = [
        r.softCriteria.pronounceable ? "✓" : "·",
        r.softCriteria.namesTension ? "✓" : "·",
      ];
      console.log(
        `PASS  ${r.output?.shortcode.padEnd(8)} ${marks.join("")}  (${r.model}${r.fallbacksUsed ? `+${r.fallbacksUsed}fb` : ""})`,
      );
    } else {
      console.log(
        `FAIL  ${r.error ? r.error.slice(0, 60) : JSON.stringify(r.hardCriteria)}`,
      );
    }
  }

  const passed = results.filter((r) => r.passed).length;
  const pronounceable = results.filter(
    (r) => r.softCriteria.pronounceable,
  ).length;
  const tensionNaming = results.filter(
    (r) => r.softCriteria.namesTension,
  ).length;
  const fallbacksEngaged = results.filter(
    (r) => (r.fallbacksUsed ?? 0) > 0,
  ).length;

  console.log(`\n━━━ BUNKER Eval Results ━━━`);
  console.log(`  HARD CRITERIA (pass threshold 13/15):`);
  console.log(
    `    ${passed} / ${EVAL_CASES.length}  ${passed >= 13 ? "✓ PASS" : "✗ FAIL"}`,
  );
  console.log(`  SOFT CRITERIA (reported, non-blocking):`);
  console.log(
    `    Shortcodes pronounceable:  ${pronounceable} / ${EVAL_CASES.length}`,
  );
  console.log(
    `    Concepts name tension:     ${tensionNaming} / ${EVAL_CASES.length}`,
  );
  console.log(`  FALLBACKS:`);
  console.log(
    `    Cases using fallback chain: ${fallbacksEngaged} / ${EVAL_CASES.length}`,
  );

  if (passed >= 13) {
    console.log(
      `\n✓ BUNKER evals PASS — Phase 6 acceptance criteria met (${passed}/15, threshold 13).`,
    );
    process.exit(0);
  } else {
    console.log(
      `\n✗ BUNKER evals FAIL — ${passed}/15, threshold 13 not met. Failed cases:`,
    );
    for (const r of results.filter((r) => !r.passed)) {
      console.log(`  - ${r.id}: ${r.error ?? JSON.stringify(r.hardCriteria)}`);
    }
    process.exit(1);
  }
}

main().catch((e) => {
  console.error("\n✗ Eval suite crashed:", (e as Error).message);
  if ((e as Error).stack) console.error((e as Error).stack);
  process.exit(1);
});
