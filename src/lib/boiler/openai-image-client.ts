/**
 * Phase 11D — OpenAI Images API client.
 *
 * Fetch-based wrapper around the canonical OpenAI image generation endpoints:
 *   - POST /v1/images/generations    fresh generation from prompt
 *   - POST /v1/images/edits          refinement: previous image + prompt
 *
 * MODEL SWAP HISTORY:
 *   - May 16, 2026: shipped on "gpt-image-1" (the earlier plan of "gpt-image-2"
 *     failed — it's not a real API model ID; that name was the ChatGPT consumer
 *     product's UI labeling for what the API exposes as chatgpt-image-latest).
 *   - May 19, 2026: swapped to "chatgpt-image-latest" after Inba's question
 *     surfaced the model in a fresh /v1/models probe (it wasn't in the May 17
 *     probe). Required OpenAI organization verification (one-time Persona ID
 *     upload). Validated live with a PAPER-RCK-style prompt: produces 6+
 *     element multi-element compositions with conceptual logic — the same
 *     output class as the PAPER-RCK reference (which was almost certainly
 *     generated via this model through ChatGPT consumer product, not via API).
 *
 * Both models support transparent backgrounds on both /generations and /edits
 * endpoints. Tier pricing is approximated from gpt-image-1's published rates
 * (low $0.006 / med $0.053 / high $0.211) — chatgpt-image-latest's actual
 * pricing TBD from OpenAI dashboard; adjust TIER_PRICING in types.ts if the
 * usage dashboard shows materially different per-call cost.
 *
 * Reads `process.env.OPENAI_API_KEY` for auth. NEVER reads .env.local directly,
 * NEVER logs the key. Throws Error with provider message on non-2xx.
 */

import type { Tier } from "@/db/zod";
import { TIER_PRICING } from "./types";

const OPENAI_GENERATIONS_URL = "https://api.openai.com/v1/images/generations";
const OPENAI_EDITS_URL = "https://api.openai.com/v1/images/edits";
const IMAGE_MODEL = "chatgpt-image-latest";
const DEFAULT_TIMEOUT_MS = 120_000; // high-tier can take 60s+

export interface GenerateImageOptions {
  /** Prompt text. */
  prompt: string;
  /** Quality tier — maps to the OpenAI image "quality" parameter via TIER_PRICING. */
  tier: Tier;
  /**
   * When set, hits the /edits endpoint with the previous image as input.
   * The model sees both prompt + prior image and produces a refined version.
   * Same conceptual UX as `previous_response_id` chaining on the Responses API,
   * different mechanism underneath.
   */
  previousImageBase64?: string;
  /** Model override for evals. Default: "chatgpt-image-latest" (see file header for swap history). */
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
