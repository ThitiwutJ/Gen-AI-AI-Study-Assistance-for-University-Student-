import path from "node:path";

/**
 * Server-side configuration read from environment variables.
 * None of these are secrets except OPENAI_COMPAT_API_KEY (optional, only for
 * the alternative OpenAI-compatible provider). Ollama needs no key.
 */

function int(name: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

function str(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

export type ProviderKind = "ollama" | "openai-compatible";

export const config = {
  provider: (str("AI_PROVIDER") === "openai-compatible" ? "openai-compatible" : "ollama") as ProviderKind,

  ollama: {
    baseUrl: (str("OLLAMA_BASE_URL") ?? "http://127.0.0.1:11434").replace(/\/+$/, ""),
    model: str("OLLAMA_MODEL"),
    embedModel: str("OLLAMA_EMBED_MODEL"),
    keepAlive: str("OLLAMA_KEEP_ALIVE") ?? "10m",
  },

  openaiCompatible: {
    baseUrl: (str("OPENAI_COMPAT_BASE_URL") ?? "http://127.0.0.1:1234/v1").replace(/\/+$/, ""),
    apiKey: str("OPENAI_COMPAT_API_KEY"),
    model: str("OPENAI_COMPAT_MODEL"),
    embedModel: str("OPENAI_COMPAT_EMBED_MODEL"),
  },

  /** Default context window sent as options.num_ctx (Ollama). */
  numCtx: int("OLLAMA_NUM_CTX", 8192, 2048, 262144),

  /** Maximum time for one AI request (model load + generation). */
  requestTimeoutMs: int("AI_REQUEST_TIMEOUT_MS", 600_000, 30_000, 3_600_000),

  dataDir: path.resolve(process.cwd(), str("DATA_DIR") ?? "data"),

  maxUploadBytes: int("MAX_UPLOAD_MB", 25, 1, 200) * 1024 * 1024,

  /** Minimum cosine similarity for a vector-search hit to count as relevant. */
  minSimilarity: Number.parseFloat(process.env.RETRIEVAL_MIN_SIMILARITY ?? "0.3") || 0.3,
};
