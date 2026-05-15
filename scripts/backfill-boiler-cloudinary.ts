/**
 * Backfill: BOILER agent_outputs rows → Cloudinary URLs (Phase 11C.1).
 *
 * Retroactive migration. Walks every BOILER row where variants have
 * inline base64 (imageDataUri set + imageUrl unset), uploads each
 * variant's image to Cloudinary, replaces imageDataUri with imageUrl
 * + cloudinaryPublicId, updates `storageMode` → "cloudinary".
 *
 * Idempotent — re-running skips already-migrated rows and variants. Safe
 * to run multiple times.
 *
 * Run (live):
 *   npx tsx --env-file=.env.local scripts/backfill-boiler-cloudinary.ts
 *
 * Run (dry — no DB writes, no Cloudinary uploads, just logs what would
 * happen):
 *   npx tsx --env-file=.env.local scripts/backfill-boiler-cloudinary.ts --dry-run
 *
 * Cost: ~$0 (Cloudinary uploads are free under 25 GB storage). Latency
 * dominated by Cloudinary upload time — each variant upload ~1-2s, each
 * row has up to 4 variants → ~4-8s per row. 50 rows ≈ 6 minutes total.
 *
 * Safety:
 *   - Atomic per-row UPDATE — last-write-wins (BOILER rows aren't
 *     actively modified outside the handler runs + approve flows).
 *   - Skips refused rows (no variants to migrate).
 *   - Skips failure-marker rows (Phase 11G.3 — refused=false but
 *     content.error set).
 *   - Defensive: malformed variants are copied through unchanged, not
 *     dropped or rewritten.
 */

import "dotenv/config";
import { eq } from "drizzle-orm";
import { db, agentOutputs, signals as signalsTable } from "../src/db";
import {
  uploadBase64Image,
  isCloudinaryConfigured,
} from "../src/lib/cloudinary";

interface BoilerVariantShape {
  variantSlug?: string;
  imageDataUri?: string;
  imageUrl?: string;
  cloudinaryPublicId?: string;
  [key: string]: unknown;
}

interface BoilerContentShape {
  refused?: boolean;
  variants?: BoilerVariantShape[];
  storageMode?: string;
  storagePendingReason?: string | null;
  error?: unknown;
  [key: string]: unknown;
}

const DRY_RUN = process.argv.includes("--dry-run");

async function main(): Promise<void> {
  if (!isCloudinaryConfigured()) {
    console.error(
      "FAIL — CLOUDINARY_URL not set in env. Cannot run backfill without Cloudinary credentials.",
    );
    process.exit(1);
  }

  console.log(`Mode: ${DRY_RUN ? "DRY-RUN (no writes, no uploads)" : "LIVE"}`);
  console.log("");

  // Pull every BOILER agent_outputs row + its signal shortcode (for
  // folder naming on Cloudinary). Single-org BLIPS — no org filter
  // needed. If multi-org ever lands, this script should parameterise by
  // orgId and operate one org at a time.
  const rows = await db
    .select({
      id: agentOutputs.id,
      content: agentOutputs.content,
      signalId: agentOutputs.signalId,
      shortcode: signalsTable.shortcode,
      status: agentOutputs.status,
    })
    .from(agentOutputs)
    .innerJoin(signalsTable, eq(agentOutputs.signalId, signalsTable.id))
    .where(eq(agentOutputs.agentName, "BOILER"));

  console.log(`Found ${rows.length} BOILER rows total.`);
  console.log("");

  let migrated = 0;
  let alreadyMigrated = 0;
  let skipped = 0;
  let errored = 0;
  let variantsUploaded = 0;

  for (const row of rows) {
    const content = row.content as BoilerContentShape;
    const shortId = row.id.slice(0, 8);

    // Skip refused rows — no variants to migrate.
    if (content.refused === true) {
      console.log(`  ⊘ ${row.shortcode} (${shortId}) — refused, no variants`);
      skipped++;
      continue;
    }

    // Skip failure-marker rows (Phase 11G.3 onFailure persistence pattern).
    if (content.error) {
      console.log(
        `  ⊘ ${row.shortcode} (${shortId}) — failure marker row, skipping`,
      );
      skipped++;
      continue;
    }

    const variants = content.variants;
    if (!Array.isArray(variants) || variants.length === 0) {
      console.log(
        `  ⊘ ${row.shortcode} (${shortId}) — no variants array, skipping`,
      );
      skipped++;
      continue;
    }

    // Already migrated?
    const needsMigration = variants.some(
      (v) => typeof v.imageDataUri === "string" && !v.imageUrl,
    );
    if (!needsMigration) {
      console.log(
        `  ✓ ${row.shortcode} (${shortId}) — already on Cloudinary`,
      );
      alreadyMigrated++;
      continue;
    }

    console.log(
      `  → ${row.shortcode} (${shortId}) — migrating ${variants.length} variants`,
    );

    const newVariants: BoilerVariantShape[] = [];
    let rowSucceeded = true;

    for (const variant of variants) {
      const slug = variant.variantSlug ?? "(no-slug)";

      // Already migrated — pass through.
      if (variant.imageUrl) {
        newVariants.push(variant);
        continue;
      }

      // No image at all — defensive; pass through unchanged.
      if (typeof variant.imageDataUri !== "string") {
        console.warn(
          `      ! ${slug}: no imageDataUri AND no imageUrl — passing through unchanged`,
        );
        newVariants.push(variant);
        continue;
      }

      // Extract bare base64 from the data URI.
      const match = variant.imageDataUri.match(
        /^data:image\/[^;]+;base64,(.+)$/,
      );
      if (!match) {
        console.warn(
          `      ! ${slug}: imageDataUri doesn't match expected pattern — passing through`,
        );
        newVariants.push(variant);
        continue;
      }
      const base64 = match[1];

      if (DRY_RUN) {
        console.log(
          `      [dry-run] would upload ${slug} (${base64.length} chars base64)`,
        );
        newVariants.push(variant);
        variantsUploaded++;
        continue;
      }

      try {
        const uploadResult = await uploadBase64Image(base64, {
          folder: `blips/boiler/${row.shortcode}`,
          publicIdHint: slug,
          overwrite: true,
        });
        // Drop imageDataUri, add imageUrl + cloudinaryPublicId
        const migrated: BoilerVariantShape = {
          ...variant,
          imageUrl: uploadResult.optimizedUrl,
          cloudinaryPublicId: uploadResult.publicId,
        };
        delete migrated.imageDataUri;
        newVariants.push(migrated);
        console.log(`      ✓ ${slug} → ${uploadResult.optimizedUrl}`);
        variantsUploaded++;
      } catch (e) {
        console.error(
          `      ✗ ${slug}: upload failed — ${(e as Error).message}`,
        );
        newVariants.push(variant);
        rowSucceeded = false;
      }
    }

    if (!rowSucceeded) {
      console.error(
        `    PARTIAL — ${row.shortcode} had upload errors; row NOT updated to avoid mixed state`,
      );
      errored++;
      continue;
    }

    if (DRY_RUN) {
      migrated++;
      continue;
    }

    try {
      await db
        .update(agentOutputs)
        .set({
          content: {
            ...content,
            variants: newVariants,
            storageMode: "cloudinary",
            storagePendingReason: null,
          },
        })
        .where(eq(agentOutputs.id, row.id));
      migrated++;
    } catch (e) {
      console.error(
        `    DB UPDATE failed for ${row.shortcode}: ${(e as Error).message}`,
      );
      errored++;
    }
  }

  console.log("");
  console.log("─── Result ───");
  console.log(`  Migrated:          ${migrated}`);
  console.log(`  Already migrated:  ${alreadyMigrated}`);
  console.log(
    `  Skipped:           ${skipped} (refused / failure-marker / no variants)`,
  );
  console.log(`  Errored:           ${errored}`);
  console.log(`  Variants uploaded: ${variantsUploaded}`);
  console.log("");
  if (DRY_RUN) {
    console.log(
      "Dry-run complete. Re-run without --dry-run to apply changes.",
    );
  } else if (errored > 0) {
    console.log(
      "Some rows errored — review logs above. Re-run is safe (idempotent).",
    );
  } else if (migrated > 0) {
    console.log(
      "Backfill complete. All BOILER rows now reference Cloudinary URLs.",
    );
  }

  process.exit(errored > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error("Backfill script crashed:", e);
  process.exit(2);
});
