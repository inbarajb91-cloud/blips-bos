import type { MemoryBackend } from "./types";
import { NoopMemoryBackend } from "./noop";

/**
 * Memory backend factory — Phase 8K.
 *
 * Returns the configured memory backend. Cached per-process (Node
 * module cache) so we don't reconstruct the supermemory client on
 * every call.
 *
 * Selection rule (current):
 *   - SUPERMEMORY_API_KEY present → SupermemoryBackend
 *   - otherwise → NoopMemoryBackend (silent degrade, logs once)
 *
 * Future selection (when pg_vector backend lands):
 *   MEMORY_BACKEND env var: 'supermemory' | 'pgvector' | 'noop'
 *
 * The dynamic import keeps the supermemory SDK out of the cold-start
 * critical path on routes that don't touch memory. It also lets the
 * file compile in environments where the package isn't installed yet
 * (the import only runs when SUPERMEMORY_API_KEY is set).
 */

let cached: MemoryBackend | null = null;

export async function getMemoryBackend(): Promise<MemoryBackend> {
  if (cached) return cached;

  const apiKey = process.env.SUPERMEMORY_API_KEY;
  if (!apiKey) {
    cached = new NoopMemoryBackend();
    return cached;
  }

  // Dynamic import so the supermemory SDK only loads when configured.
  // Avoids cold-start cost on routes that don't touch memory.
  const { SupermemoryBackend } = await import("./supermemory");
  cached = new SupermemoryBackend({ apiKey });
  return cached;
}

/**
 * Reset the cached backend. Test-only — never call from app code.
 * Useful when a test wants to swap in a mock backend.
 */
export function __resetMemoryBackendForTests(
  backend: MemoryBackend | null = null,
): void {
  cached = backend;
}

export type {
  MemoryBackend,
  MemoryItem,
  MemoryKind,
  RecallScope,
  MemoryHit,
} from "./types";
