/**
 * One-shot — list document counts for old + new supermemory tags so
 * we can confirm the migration worked. Delete after verification.
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

async function main() {
  const Supermemory = (await import("supermemory")).default;
  const client = new Supermemory({ apiKey: process.env.SUPERMEMORY_API_KEY! });
  const tags = [
    "org-blips-events",
    "org-blips-knowledge",
    "org-test-blips",
    "org-f21c2a4b-76e2-48b8-bb21-0ed449a807b1",
    "org-test-f21c2a4b-76e2-48b8-bb21-0ed449a807b1",
  ];
  for (const tag of tags) {
    const r = await client.documents.list({
      containerTags: [tag],
      limit: 100,
      page: 1,
      includeContent: false,
    });
    console.log(`${tag.padEnd(50)} → ${(r.memories ?? []).length} doc(s)`);
  }
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
