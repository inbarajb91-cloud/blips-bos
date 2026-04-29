/**
 * Phase 9B structural smoke test — verifies the STOKER skill registers
 * and its input/output schemas validate correctly. NO live LLM call.
 *
 * Run: npx tsx scripts/stoker-skill-smoke.ts
 */
import { existsSync, readFileSync } from "node:fs";

if (existsSync(".env.local")) {
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
}

let passed = 0;
let failed = 0;
function pass(msg: string) {
  console.log(`  ✓ ${msg}`);
  passed++;
}
function fail(msg: string) {
  console.log(`  ✗ ${msg}`);
  failed++;
}

async function main() {
  const { loadSkill, listRegisteredSkills } = await import("@/skills");
  // Ensure stoker import side-effect runs
  await import("@/skills/stoker");

  // ─── 1. Skill registered ──────────────────────────────────────
  console.log("\n[smoke] 1. STOKER registered in skill registry");
  const list = listRegisteredSkills();
  if (list.includes("STOKER")) pass(`registry contains STOKER (alongside ${list.join(", ")})`);
  else fail(`registry missing STOKER (only has ${list.join(", ")})`);

  const skill = loadSkill("STOKER");
  if (skill) pass("loadSkill('STOKER') returns non-null");
  else {
    fail("loadSkill('STOKER') returned null");
    return finish();
  }

  if (skill.name === "STOKER") pass("skill.name === 'STOKER'");
  else fail(`skill.name is ${skill.name}`);

  // ─── 2. Input schema validates a happy-path input ─────────────
  console.log("\n[smoke] 2. Input schema validates a valid input");
  const validInput = {
    // Valid UUID v4 (Zod's UUID format is strict — version + variant nibbles)
    signalId: "550e8400-e29b-41d4-a716-446655440000",
    shortcode: "VOTER",
    workingTitle: "Election Turnout Tension",
    concept: "The tension between civic duty and the friction of showing up.",
    rawExcerpt: "Before the 2026 elections, the highest turnout was recorded in 2011...",
    sourceUrl: "https://example.com/article",
    decadeHintFromCollection: null,
    playbooks: { rck: "", rcl: "", rcd: "" },
  };

  const inputResult = skill.inputSchema.safeParse(validInput);
  if (inputResult.success) pass("happy-path input validates");
  else fail(`input rejected: ${JSON.stringify(inputResult.error.issues)}`);

  // ─── 3. Output schema accepts a valid happy-path output ───────
  console.log("\n[smoke] 3. Output schema validates a happy-path output");
  const validOutput = {
    overallRationale:
      "VOTER cuts at the act of voting itself, not the political content. Lands at career inflection (RCK), parenthood-pivot (RCL), and reckoning (RCD) — strongest at RCL because the inheritance question makes the act personal.",
    decades: [
      {
        decade: "RCK",
        resonanceScore: 78,
        rationale:
          "RCK is at the inflection where civic identity is being formed. Turnout fear reads as 'I have a Monday meeting at 9, why am I queuing for an hour' against 'this is the vote that defines my country.'",
        manifestation: {
          framingHook: "The first vote that mattered — the one you almost didn't cast.",
          tensionAxis: "Civic identity vs urban friction",
          narrativeAngle:
            "RCK is at the inflection where civic identity is being formed. Turnout fear reads as 'I have a Monday at 9, why am I queuing?' against 'this is the vote that defines my country.' The act either becomes a habit or it doesn't.",
          dimensionAlignment: {
            social: "Friends debating whether to bother",
            musical: "",
            cultural: "Generational handoff of disillusionment",
            career: "Monday meeting at 9 vs civic act",
            responsibilities: "",
            expectations: "Modeling participation",
            sports: "",
          },
        },
      },
      {
        decade: "RCL",
        resonanceScore: 84,
        rationale: "RCL has parenthood-pivot energy. Voting becomes the inheritance question made concrete: what does my child see me do?",
        manifestation: {
          framingHook: "The vote you stopped showing up for. The one your child made you start casting again.",
          tensionAxis: "Inheritance question — what does the next generation get from us about civic act",
          narrativeAngle:
            "RCL has parenthood-pivot energy. Voting becomes the inheritance question made concrete. Cynicism passes down through what we model, not what we say.",
          dimensionAlignment: {
            social: "WhatsApp groups debating turnout",
            musical: "",
            cultural: "Generational handoff",
            career: "",
            responsibilities: "Parenthood-as-witness",
            expectations: "Civic-act-as-modeling",
            sports: "",
          },
        },
      },
      {
        decade: "RCD",
        resonanceScore: 41,
        rationale: "RCD's reckoning frame doesn't engage with civic act directly — accumulated meaning is there but the cohort's relationship to voting is more settled, less tense.",
        manifestation: null,
      },
    ],
    refused: false,
    refusalRationale: null,
  };

  const outputResult = skill.outputSchema.safeParse(validOutput);
  if (outputResult.success) pass("happy-path output validates");
  else fail(`output rejected: ${JSON.stringify(outputResult.error.issues)}`);

  // ─── 4. Refusal output (all <50, refused=true) ────────────────
  console.log("\n[smoke] 4. Refusal output validates");
  const refusalOutput = {
    overallRationale: "PIDGN reads as observational texture (city softening) without a tension axis to cut against. Decade-specific manifestations would all read as the same generic angle word-swapped.",
    decades: [
      {
        decade: "RCK",
        resonanceScore: 32,
        rationale: "No cohort-specific tension. Pigeons returning reads as a shared cultural moment, not RCK-coded.",
        manifestation: null,
      },
      {
        decade: "RCL",
        resonanceScore: 38,
        rationale: "Closest fit — RCL has the longest memory of pre-pollution Bombay. But nostalgia, not tension. No cut.",
        manifestation: null,
      },
      {
        decade: "RCD",
        resonanceScore: 28,
        rationale: "Even thinner. RCD's reckoning frame doesn't engage with cohabitation-with-nature.",
        manifestation: null,
      },
    ],
    refused: true,
    refusalRationale: "All three decades score below 50. The signal lacks a psychological tension axis — observational texture only. Founder may force-add if they see an angle.",
  };

  const refusalResult = skill.outputSchema.safeParse(refusalOutput);
  if (refusalResult.success) pass("refusal output validates");
  else fail(`refusal rejected: ${JSON.stringify(refusalResult.error.issues)}`);

  // ─── 5. Inconsistent refusal output should FAIL ───────────────
  console.log("\n[smoke] 5. Inconsistent output rejected by refine()");
  const badOutput1 = { ...refusalOutput, refused: false }; // all <50 but refused=false
  const badResult1 = skill.outputSchema.safeParse(badOutput1);
  if (!badResult1.success) pass("rejects refused=false when all decades < 50");
  else fail("DID NOT reject inconsistent refused=false");

  const badOutput2 = {
    ...validOutput,
    decades: validOutput.decades.map((d, i) =>
      i === 0 ? { ...d, manifestation: null } : d, // RCK score 78 but manifestation null
    ),
  };
  const badResult2 = skill.outputSchema.safeParse(badOutput2);
  if (!badResult2.success) pass("rejects null manifestation on a decade scoring >= 50");
  else fail("DID NOT reject null manifestation on score 78");

  // ─── 6. buildPrompt returns a string with key signal fields ──
  console.log("\n[smoke] 6. buildPrompt produces a populated prompt");
  const prompt = skill.buildPrompt(validInput);
  if (typeof prompt === "string" && prompt.length > 200) pass(`buildPrompt returned ${prompt.length}-char prompt`);
  else fail("buildPrompt returned an empty/short string");

  if (prompt.includes("VOTER")) pass("prompt contains shortcode");
  else fail("prompt missing shortcode");
  if (prompt.includes("Election Turnout Tension")) pass("prompt contains working title");
  else fail("prompt missing working title");
  // buildPrompt formats playbook headers as "### RCK · 28-38 · The Reckoning PLAYBOOK"
  // (decade · age · name), not just "RCK PLAYBOOK"
  if (
    prompt.includes("RCK · 28-38") &&
    prompt.includes("RCL · 38-48") &&
    prompt.includes("RCD · 48-58")
  )
    pass("prompt has all three decade playbook sections");
  else fail("prompt missing one or more decade playbook sections");

  finish();
}

function finish() {
  console.log(`\n[smoke] result: ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("[smoke] fatal:", err);
  process.exit(1);
});
