/**
 * Phase 11D — OpenAI Images API client for gpt-image-1.
 *
 * Fetch-based wrapper around the canonical OpenAI image generation endpoints:
 *   - POST /v1/images/generations    fresh generation from prompt
 *   - POST /v1/images/edits          refinement: previous image + prompt
 *
 * Validated live against the real API May 16 — model "gpt-image-1" supports
 * transparent backgrounds on both endpoints. The earlier plan (gpt-image-2 +
 * Responses API + previous_response_id chaining) failed: gpt-image-2 isn't a
 * real model and the Responses-API image_generation tool doesn't support
 * transparent backgrounds. Chaining now happens by sending the parent image
 * back to /edits — same UX (multi-turn refinement on a stable canvas), different
 * implementation underneath.
 *
 * Reads `process.env.OPENAI_API_KEY` for auth. NEVER reads .env.local directly,
 * NEVER logs the key. Throws Error with provider message on non-2xx.
 */

import type { Tier } from "@/db/zod";
import { TIER_PRICING } from "./types";

const OPENAI_GENERATIONS_URL = "https://api.openai.com/v1/images/generations";
const OPENAI_EDITS_URL = "https://api.openai.com/v1/images/edits";
const IMAGE_MODEL = "gpt-image-1";
const DEFAULT_TIMEOUT_MS = 120_000; // high-tier can take 60s+

export interface GenerateImageOptions {
  /** Prompt text. */
  prompt: string;
  /** Quality tier — maps to gpt-image-1's "quality" parameter via TIER_PRICING. */
  tier: Tier;
  /**
   * When set, hits the /edits endpoint with the previous image as input.
   * The model sees both prompt + prior image and produces a refined version.
   * Same conceptual UX as `previous_response_id` chaining on the Responses API,
   * different mechanism underneath.
   */
  previousImageBase64?: string;
  /** Model override for evals. Default: "gpt-image-1". */
  model?: string;
  /** Image dimensions. Default: 1024×1024 square. */
  width?: number;
  height?: number;
  /** Per-call timeout. Default: 120s. */
  timeoutMs?: number;
}

export interface GenerateImageResult {
  /** Synthetic id (timestamp + tier) — kept for back-compat with the prior
   *  Responses API shape. The Images API has no native response id. */
  responseId: string;
  /** Base64-encoded PNG data, no data: prefix. */
  imageBase64: string;
  /** Width returned by the API. */
  widthPx: number;
  /** Height returned by the API. */
  heightPx: number;
  /** Estimated cost in USD (from TIER_PRICING). */
  costUsd: number;
  /** Wall-clock ms of the API call. */
  durationMs: number;
  /** Model id used. */
  model: string;
}

interface ImagesApiResponse {
  created: number;
  background?: string;
  data?: Array<{
    b64_json?: string;
    url?: string;
    revised_prompt?: string;
  }>;
  output_format?: string;
  quality?: string;
  size?: string;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    total_tokens?: number;
  };
}

function getApiKey(): string {
  const k = process.env.OPENAI_API_KEY;
  if (!k || k.startsWith("REPLACE_") || k.length < 20) {
    throw new Error(
      "[openai-image-client] OPENAI_API_KEY is not set (or is a placeholder). Set the real key in .env.local + Vercel env.",
    );
  }
  return k;
}

function parseSize(size: string): { w: number; h: number } {
  // gpt-image-1 sometimes returns 1254x1254 etc for high quality;
  // fall back to 1024 defaults if shape unexpected.
  const m = /^(\d+)x(\d+)$/u.exec(size);
  if (!m) return { w: 1024, h: 1024 };
  return { w: parseInt(m[1], 10), h: parseInt(m[2], 10) };
}

/** Generate or refine a transparent-background image via OpenAI's Images API. */
export async function generateImageViaResponses(
  opts: GenerateImageOptions,
): Promise<GenerateImageResult> {
  const apiKey = getApiKey();
  const model = opts.model ?? IMAGE_MODEL;
  const width = opts.width ?? 1024;
  const height = opts.height ?? 1024;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const quality = TIER_PRICING[opts.tier].quality as "low" | "medium" | "high";

  const isEdit =
    typeof opts.previousImageBase64 === "string" &&
    opts.previousImageBase64.length > 0;
  const url = isEdit ? OPENAI_EDITS_URL : OPENAI_GENERATIONS_URL;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const start = Date.now();

  let res: Response;
  try {
    if (isEdit) {
      // /edits is multipart/form-data — model expects the previous image as a
      // file field, prompt + size + quality + background as form fields.
      const form = new FormData();
      form.append("model", model);
      form.append("prompt", opts.prompt);
      form.append("size", `${width}x${height}`);
      form.append("quality", quality);
      form.append("background", "transparent");
      form.append(
        "image",
        new Blob([Buffer.from(opts.previousImageBase64!, "base64")], {
          type: "image/png",
        }),
        "parent.png",
      );

      res = await fetch(url, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}` },
        body: form,
        signal: controller.signal,
      });
    } else {
      // /generations takes JSON.
      const body = {
        model,
        prompt: opts.prompt,
        size: `${width}x${height}`,
        quality,
        background: "transparent",
        n: 1,
      };
      res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    }
  } catch (e: unknown) {
    clearTimeout(timeout);
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("aborted")) {
      throw new Error(
        `[openai-image-client] ${model} call timed out after ${timeoutMs}ms`,
      );
    }
    throw new Error(`[openai-image-client] network error: ${msg}`);
  }
  clearTimeout(timeout);

  const durationMs = Date.now() - start;

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    const errSnippet = errText.slice(0, 500);
    throw new Error(
      `[openai-image-client] ${model} (${isEdit ? "edits" : "generations"}) HTTP ${res.status}: ${errSnippet}`,
    );
  }

  const json = (await res.json()) as ImagesApiResponse;
  const first = json.data?.[0];
  if (!first) {
    throw new Error(
      `[openai-image-client] response had no data items (size=${json.size})`,
    );
  }

  let imageBase64 = first.b64_json ?? "";
  if (!imageBase64 && first.url) {
    const imgRes = await fetch(first.url);
    if (!imgRes.ok) {
      throw new Error(
        `[openai-image-client] data[0].url fetch failed: HTTP ${imgRes.status}`,
      );
    }
    const buf = Buffer.from(await imgRes.arrayBuffer());
    imageBase64 = buf.toString("base64");
  }
  if (!imageBase64) {
    throw new Error(
      `[openai-image-client] data[0] had neither b64_json nor url`,
    );
  }

  const { w, h } = parseSize(json.size ?? `${width}x${height}`);

  return {
    responseId: `img_${Date.now()}_${opts.tier}_${isEdit ? "edit" : "gen"}`,
    imageBase64,
    widthPx: w,
    heightPx: h,
    costUsd: TIER_PRICING[opts.tier].usd,
    durationMs,
    model,
  };
}

/**
 * Sanity probe — generates a low-tier dot to confirm:
 *   - OPENAI_API_KEY is set + valid
 *   - gpt-image-1 is reachable
 *   - Transparent backgrounds work
 * Returns true on success, throws on failure.
 */
export async function probeOpenAIResponses(): Promise<boolean> {
  await generateImageViaResponses({
    prompt: "a single black dot, centered, transparent background",
    tier: "low",
    timeoutMs: 30_000,
  });
  return true;
}
