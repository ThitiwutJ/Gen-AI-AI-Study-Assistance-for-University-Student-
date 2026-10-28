import { AppError, aiErrors } from "@/lib/errors";
import { config } from "@/lib/config";

/**
 * Combine the caller's signal with a timeout and map network failures to clear errors.
 * Returns the response plus `mapError`, which must be used for errors thrown while
 * reading a streamed body (the timeout can fire mid-stream).
 */
export async function aiFetch(
  url: string,
  init: RequestInit & { timeoutMs?: number; providerKind: "ollama" | "openai-compatible"; baseUrl: string },
): Promise<{ res: Response; mapError: (error: unknown) => AppError }> {
  const timeoutMs = init.timeoutMs ?? config.requestTimeoutMs;
  const timeout = AbortSignal.timeout(timeoutMs);
  const caller = init.signal ?? undefined;
  const signal = caller ? AbortSignal.any([caller, timeout]) : timeout;
  const mapError = (error: unknown) =>
    mapFetchError(error, { timeout, caller, timeoutMs, kind: init.providerKind, baseUrl: init.baseUrl });
  const { timeoutMs: _t, providerKind: _k, baseUrl: _b, ...rest } = init;
  void _t;
  void _k;
  void _b;
  try {
    const res = await fetch(url, { ...rest, signal });
    return { res, mapError };
  } catch (error) {
    throw mapError(error);
  }
}

export function mapFetchError(
  error: unknown,
  ctx: { timeout: AbortSignal; caller?: AbortSignal; timeoutMs: number; kind: "ollama" | "openai-compatible"; baseUrl: string },
): AppError {
  if (error instanceof AppError) return error;
  if (ctx.caller?.aborted) return aiErrors.cancelled();
  if (ctx.timeout.aborted) return aiErrors.timeout(Math.round(ctx.timeoutMs / 1000));
  const name = error instanceof Error ? error.name : "";
  if (name === "AbortError" || name === "TimeoutError") return aiErrors.timeout(Math.round(ctx.timeoutMs / 1000));
  return aiErrors.notRunning(ctx.baseUrl, ctx.kind);
}

export async function readErrorText(res: Response): Promise<string> {
  const text = await res.text().catch(() => "");
  try {
    const json = JSON.parse(text) as { error?: string | { message?: string } };
    if (typeof json.error === "string") return json.error;
    if (json.error && typeof json.error.message === "string") return json.error.message;
  } catch {
    /* not JSON */
  }
  return text.slice(0, 300) || `HTTP ${res.status}`;
}

/** Split a streamed response body into lines. */
export async function* readLines(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let newline = buffer.indexOf("\n");
      while (newline !== -1) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (line) yield line;
        newline = buffer.indexOf("\n");
      }
    }
    buffer += decoder.decode();
    if (buffer.trim()) yield buffer.trim();
  } finally {
    reader.releaseLock();
  }
}
