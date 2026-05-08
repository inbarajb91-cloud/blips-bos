/**
 * Image-generation provider registry — Phase 11A.
 *
 * Parallel structure to `src/lib/ai/providers.ts` (text-model registry,
 * Phase 3.5). Image generation has a different SDK shape from text —
 * `imageModel(id)` factories on @ai-sdk/openai + @ai-sdk/google return
 * `ImageModel` instances consumed by AI SDK's `generateImage()`. So
 * this is a separate registry instead of folding image support into
 * the text providers file.
 *
 * Supported providers (Phase 11):
 *   - openai → gpt-image-1 + variants (dall-e-3, dall-e-2 legacy)
 *   - google → imagen-4 family + gemini-3-pro-image variants
 *   - openai-compatible (single registration covering Ideogram via
 *     fal.ai / Replicate / OpenRouter, Flux 1.1 Pro Ultra via fal.ai,
 *     etc.). Endpoint URL configured per-provider with their respective
 *     env keys (FAL_API_KEY / REPLICATE_API_TOKEN / OPENROUTER_API_KEY).
 *
 * BLIPS default chain (per agents/skills.md §10.2 + agents/BOILER.md
 * Decision §1):
 *   - Default: gpt-image-1 (OpenAI) — best instruction-following + typography
 *   - Type-led override: ideogram-v3 — best at rendering text in images
 *   - Photographic override: imagen-4.0-generate-001 — strongest photoreal
 *
 * The skill (Phase 11B) inspects FURNACE brief sections (compositionApproach,
 * typographicTreatment) and picks the right primary at call time. Founder
 * can override via Settings → Agent Models → BOILER (Phase 11A wires this
 * in — the same UI patterns from Phase 3.5 extended to image models).
 */

import { openai } from "@ai-sdk/openai";
import { google } from "@ai-sdk/google";
import type { ImageModel } from "ai";

export type ImageProviderId =
  | "openai"
  | "google"
  | "fal"
  | "replicate"
  | "openrouter-image";

export interface ImageProviderDef {
  id: ImageProviderId;
  displayName: string;
  envVar: string;
  /** Pretty list of canonical model ids served by this provider. Used by
   *  the Settings UI's image-model dropdown. Free-text entry still works;
   *  the catalog is just hints. */
  knownModels: string[];
  /** Returns an AI SDK ImageModel for the given bare model id. */
  make: (modelId: string) => ImageModel;
  bareModelPattern?: RegExp;
}

// ─── First-party image providers ────────────────────────────────

const OPENAI_IMG: ImageProviderDef = {
  id: "openai",
  displayName: "OpenAI (gpt-image-1)",
  envVar: "OPENAI_API_KEY",
  knownModels: [
    "gpt-image-1",
    "gpt-image-1-mini",
    "gpt-image-1.5",
    "dall-e-3",
    "dall-e-2",
  ],
  make: (modelId) => openai.imageModel(modelId),
  // gpt-image-* and dall-e-*
  bareModelPattern: /^(gpt-image|dall-e)/i,
};

const GOOGLE_IMG: ImageProviderDef = {
  id: "google",
  displayName: "Google (Imagen / Gemini Image)",
  envVar: "GOOGLE_GENERATIVE_AI_API_KEY",
  knownModels: [
    "imagen-4.0-generate-001",
    "imagen-4.0-ultra-generate-001",
    "imagen-4.0-fast-generate-001",
    "gemini-2.5-flash-image",
    "gemini-3-pro-image-preview",
    "gemini-3.1-flash-image-preview",
  ],
  // @ai-sdk/google exposes `image(id)` (not `imageModel(id)`); call
  // matches their public surface as of v3.0.x.
  make: (modelId) => google.image(modelId),
  // imagen-* OR gemini-*-image*
  bareModelPattern: /^(imagen-|gemini-.*-image)/i,
};

// ─── OpenAI-compatible image endpoints ─────────────────────────────
//
// Ideogram v3, Flux 1.1 Pro Ultra, Stability SD 3.5, etc. all live
// behind hosted endpoints (fal.ai, Replicate, OpenRouter image, fal-
// flagship clusters). These don't have a unified AI SDK image surface
// the way text does — different services use different request shapes.
//
// Phase 11A approach: stub the registry entries + envVar definitions so
// the Settings UI surfaces them, but mark `make()` as not-yet-wired
// (throws a clear "TODO Phase 11A.1" error). When the founder wants to
// actually test e.g. Ideogram, we wire its specific HTTP shape — fal.ai
// uses /v1/{modelId}/queue + polling, very different from OpenAI's shape.
//
// Rather than build a fake-OpenAI-compatible adapter that papers over
// the differences (and lies about what's actually implemented), we ship
// the registry stub + clear errors. Founder can probe via the existing
// CLI; if the call fails with "TODO Phase 11A.1" they know what's left.

function makeStubProvider(
  id: ImageProviderId,
  displayName: string,
  envVar: string,
  knownModels: string[],
): ImageProviderDef {
  return {
    id,
    displayName,
    envVar,
    knownModels,
    make: () => {
      throw new Error(
        `Image provider "${id}" is registered in the catalog but its HTTP adapter is not yet wired (Phase 11A.1 followup). Use openai or google for now; the Settings UI will surface a clear "no adapter yet" message.`,
      );
    },
  };
}

const FAL_IMG = makeStubProvider(
  "fal",
  "fal.ai (Flux / Ideogram / SD 3.5)",
  "FAL_API_KEY",
  [
    "fal/flux-1.1-pro-ultra",
    "fal/flux-1.1-pro",
    "fal/ideogram-v3",
    "fal/stable-diffusion-3.5-large",
  ],
);

const REPLICATE_IMG = makeStubProvider(
  "replicate",
  "Replicate (broad open-weights catalog)",
  "REPLICATE_API_TOKEN",
  [
    "replicate/black-forest-labs/flux-1.1-pro-ultra",
    "replicate/ideogram-ai/ideogram-v3",
    "replicate/stability-ai/stable-diffusion-3.5-large",
  ],
);

const OPENROUTER_IMG = makeStubProvider(
  "openrouter-image",
  "OpenRouter (image endpoints)",
  "OPENROUTER_API_KEY",
  [
    "openrouter-image/black-forest-labs/flux-1.1-pro-ultra",
    "openrouter-image/ideogram-ai/ideogram-v3",
  ],
);

// ─── Registry ────────────────────────────────────────────────────

export const IMAGE_PROVIDERS: Record<ImageProviderId, ImageProviderDef> = {
  openai: OPENAI_IMG,
  google: GOOGLE_IMG,
  fal: FAL_IMG,
  replicate: REPLICATE_IMG,
  "openrouter-image": OPENROUTER_IMG,
};

export const IMAGE_PROVIDER_LIST: ImageProviderDef[] =
  Object.values(IMAGE_PROVIDERS);

const PREFIX_KEYS: Array<{ prefix: string; id: ImageProviderId }> =
  IMAGE_PROVIDER_LIST.map((p) => ({ prefix: `${p.id}/`, id: p.id })).sort(
    (a, b) => b.prefix.length - a.prefix.length,
  );

/**
 * Resolve an image-model id string to the right provider + bare name.
 * Same shape as `resolveProvider()` for text models.
 */
export function resolveImageProvider(
  modelId: string,
): { provider: ImageProviderDef; modelName: string } | null {
  for (const { prefix, id } of PREFIX_KEYS) {
    if (modelId.startsWith(prefix)) {
      const modelName = modelId.slice(prefix.length);
      // CR pass 1 fix: reject inputs like "openai/" (empty suffix) before
      // dispatching to provider.make() — the SDK factories don't validate
      // empty model ids and return broken model instances that fail at
      // call time with confusing errors. Caller should get a deterministic
      // null here so the upstream "Unknown image model" error fires.
      if (modelName.length === 0) return null;
      return { provider: IMAGE_PROVIDERS[id], modelName };
    }
  }
  for (const provider of IMAGE_PROVIDER_LIST) {
    if (provider.bareModelPattern && provider.bareModelPattern.test(modelId)) {
      return { provider, modelName: modelId };
    }
  }
  return null;
}

/**
 * Resolve an image-model id to an AI SDK ImageModel. Throws on unknown
 * model strings or unwired providers.
 */
export function getImageModel(modelId: string): ImageModel {
  const resolved = resolveImageProvider(modelId);
  if (!resolved) {
    throw new Error(
      `Unknown image model: "${modelId}". Use a provider-prefixed form like ` +
        `"openai/gpt-image-1", "google/imagen-4.0-generate-001", or a known ` +
        `bare id ("gpt-image-1", "imagen-4.0-generate-001"). Register new ` +
        `providers in src/lib/ai/image-providers.ts.`,
    );
  }
  return resolved.provider.make(resolved.modelName);
}
