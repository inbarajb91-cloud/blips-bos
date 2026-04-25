import type {
  MemoryBackend,
  MemoryHit,
  MemoryItem,
  RecallScope,
} from "./types";

/**
 * No-op memory backend — Phase 8K.
 *
 * Used when SUPERMEMORY_API_KEY is unset (local dev, preview branches
 * without the key, CI). Lets the rest of the app keep working as if
 * memory is configured — write hooks succeed silently, recall returns
 * an empty list, ORC degrades to per-signal context.
 *
 * Logs a single warning at construction so the absence is visible in
 * dev logs without spamming on every call.
 */
export class NoopMemoryBackend implements MemoryBackend {
  constructor() {
    if (process.env.NODE_ENV !== "test") {
      console.warn(
        "[memory] No memory backend configured (SUPERMEMORY_API_KEY missing). " +
          "Using NoopMemoryBackend — writes are dropped, recall returns [].",
      );
    }
  }

  async remember(_item: MemoryItem): Promise<{ id: string }> {
    return { id: "" };
  }

  async recall(
    _query: string,
    _scope: RecallScope,
  ): Promise<MemoryHit[]> {
    return [];
  }
}
