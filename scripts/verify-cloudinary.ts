/**
 * Verify the Cloudinary connection.
 *
 * Deterministic sanity check that:
 *   1. CLOUDINARY_URL is set + parses into cloud_name / api_key / api_secret.
 *   2. The credentials actually work end-to-end against the Cloudinary API
 *      by uploading a tiny 1×1 PNG and then deleting it.
 *
 * NOT a stress test — just confirms the env is right and the account is
 * reachable. Matches the verify-script pattern from
 * scripts/verify-orc-web-search.ts.
 *
 * Run:
 *   npx tsx --env-file=.env.local scripts/verify-cloudinary.ts
 *
 * Exit code:
 *   0 — credentials present, parsed, upload + delete succeeded
 *   1 — CLOUDINARY_URL missing or malformed
 *   2 — upload failed (likely wrong key/secret or network issue)
 *   3 — script crashed
 *
 * Secret hygiene: this script NEVER prints the api_key or api_secret.
 * It prints cloud_name (which is the public part of the URL) + lengths
 * for the secrets so you can confirm they were parsed without exposing
 * them.
 */

import "dotenv/config";
import { v2 as cloudinary } from "cloudinary";

// 1×1 transparent PNG, base64-encoded. ~76 chars decoded to 44 bytes.
// Smallest valid PNG — exercises the upload path without burning any
// real storage.
const PIXEL_PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

async function main(): Promise<void> {
  // The cloudinary SDK auto-parses CLOUDINARY_URL when config() is
  // called with no args. If the env var isn't set, cfg fields come back
  // empty.
  cloudinary.config();
  const cfg = cloudinary.config() as {
    cloud_name?: string;
    api_key?: string;
    api_secret?: string;
  };

  console.log(`Cloud name:        ${cfg.cloud_name ?? "(missing)"}`);
  console.log(`API key length:    ${cfg.api_key?.length ?? 0}`);
  console.log(`API secret length: ${cfg.api_secret?.length ?? 0}`);
  console.log("");

  if (!cfg.cloud_name || !cfg.api_key || !cfg.api_secret) {
    console.error(
      "FAIL — CLOUDINARY_URL missing or malformed. Expected format: cloudinary://<api_key>:<api_secret>@<cloud_name>",
    );
    process.exit(1);
  }

  // Live probe — upload a 1×1 PNG, confirm we get a URL back, then
  // delete it. Folder `blips-verify/` so any orphan probe assets are
  // easy to find + manually clean later.
  const start = Date.now();
  const publicIdHint = `probe-${Date.now()}`;
  let uploadedPublicId: string | null = null;

  try {
    const result = await cloudinary.uploader.upload(
      `data:image/png;base64,${PIXEL_PNG}`,
      {
        folder: "blips-verify",
        public_id: publicIdHint,
        overwrite: true,
        resource_type: "image",
      },
    );
    const ms = Date.now() - start;
    uploadedPublicId = result.public_id;

    console.log(`Upload OK in ${ms}ms`);
    console.log(`  secure_url: ${result.secure_url}`);
    console.log(`  public_id:  ${result.public_id}`);
    console.log(`  format:     ${result.format}`);
    console.log(`  bytes:      ${result.bytes}`);
    console.log(`  width×h:    ${result.width}×${result.height}`);
    console.log("");
  } catch (e) {
    console.error(`FAIL — upload errored: ${(e as Error).message}`);
    process.exit(2);
  }

  // Cleanup — destroy the probe asset so we don't leave litter in the
  // account. Best-effort; if it fails the asset is still findable.
  try {
    if (uploadedPublicId) {
      const del = await cloudinary.uploader.destroy(uploadedPublicId);
      console.log(`Cleanup: ${del.result}`);
    }
  } catch (e) {
    console.warn(
      `Cleanup: failed to delete probe asset (${(e as Error).message}). Find it under blips-verify/ in the Cloudinary Media Library to remove manually.`,
    );
  }

  console.log("");
  console.log("=> PASS — Cloudinary credentials work end-to-end.");
  process.exit(0);
}

main().catch((e) => {
  console.error("verify script crashed:", e);
  process.exit(3);
});
