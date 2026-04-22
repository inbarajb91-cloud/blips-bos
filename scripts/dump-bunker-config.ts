import { db, configAgents } from "@/db";
import { eq } from "drizzle-orm";
async function main() {
  const rows = await db
    .select()
    .from(configAgents)
    .where(eq(configAgents.agentName, "BUNKER"));
  rows.sort((a, b) => a.key.localeCompare(b.key));
  for (const r of rows) {
    const v = JSON.stringify(r.value);
    console.log(r.key.padEnd(30), v.length > 140 ? v.slice(0, 140) + "..." : v);
  }
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
