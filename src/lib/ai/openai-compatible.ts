import { aiErrors, AppError } from "@/lib/errors";
import { config } from "@/lib/config";
import { aiFetch, readErrorText, readLines } from "./http";
import { stripThinking } from "./think";
import type { AIProvider, ChatRequest, ChatResult, ProviderModel } from "./types";

/**
 * Optional alternative provider for any server that speaks the OpenAI-style API
 * (/models, /chat/completions, /embeddings) — for example LM Studio or llama.cpp's server.
 * Enabled with AI_PROVIDER=openai-compatible. Ollama remains the default.
 */
const EMBED_NAME = /(embed|bge|minilm|e5-|gte-)/i;

export class OpenAICompatibleProvider implements AIProvider {
  readonly kind = "openai-compatible" as const;
  readonly supportsNumCtx = false;
  constructor(
    readonly baseUrl: string = config.openaiCompatible.baseUrl,
    private readonly apiKey: string | undefined = config.openaiCompatible.apiKey,
  ) {}

  private headers(): Record<string, string> {
    return {
      "content-type": "application/json",
      ...(this.apiKey ? { authorization: `Bearer ${this.apiKey}` } : {}),
    };
  }

  async version(): Promise<string | null> {
    return null;
  }

  async listModels(): Promise<ProviderModel[]> {
    const { res } = await aiFetch(`${this.baseUrl}/models`, {
      headers: this.headers(),
      timeoutMs: 5000,
      providerKind: this.kind,
      baseUrl: this.baseUrl,
    });
    if (!res.ok) throw aiErrors.upstream(await readErrorText(res));
    const data = (await res.json()) as { data?: { id: string }[] };
    return (data.data ?? []).map((m) => ({
      name: m.id,
      sizeBytes: null,
      parameterSize: null,
      family: null,
      capabilities: [],
      contextLength: null,
      isEmbedding: EMBED_NAME.test(m.id),
      thinking: false,
      thinkingLevels: [],
    }));
  }

  async loadedModels(): Promise<string[]> {
    return [];
  }

  async chat(req: ChatRequest): Promise<ChatResult> {
    const body: Record<string, unknown> = {
      model: req.model,
      messages: req.messages,
      stream: true,
      ...(req.numPredict ? { max_tokens: req.numPredict } : {}),
      ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
    };
    if (req.format) {
      body.response_format = { type: "json_schema", json_schema: { name: "response", schema: req.format } };
    }
    const { res, mapError } = await aiFetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(body),
      signal: req.signal,
      providerKind: this.kind,
      baseUrl: this.baseUrl,
    });
    if (!res.ok) {
      const message = await readErrorText(res);
      if (res.status === 404) throw aiErrors.modelMissing(req.model);
      throw aiErrors.upstream(message);
    }
    if (!res.body) throw aiErrors.upstream("empty response");

    let content = "";
    let thinking = "";
    let tokens = 0;
    let started = false;
    let promptTokens: number | null = null;
    let outputTokens: number | null = null;
    let doneReason: string | null = null;
    try {
      for await (const line of readLines(res.body)) {
        if (!line.startsWith("data:")) continue;
        const payload = line.slice(5).trim();
        if (payload === "[DONE]") break;
        let chunk: {
          choices?: { delta?: { content?: string; reasoning_content?: string; reasoning?: string }; finish_reason?: string | null }[];
          usage?: { prompt_tokens?: number; completion_tokens?: number };
          error?: { message?: string };
        };
        try {
          chunk = JSON.parse(payload);
        } catch {
          continue;
        }
        if (chunk.error) throw aiErrors.upstream(chunk.error.message ?? "unknown error");
        const choice = chunk.choices?.[0];
        const piece = choice?.delta?.content ?? "";
        const thought = choice?.delta?.reasoning_content ?? choice?.delta?.reasoning ?? "";
        if ((piece || thought) && !started) {
          started = true;
          req.onFirstToken?.();
        }
        if (thought) thinking += thought;
        if (piece) {
          content += piece;
          tokens++;
          req.onToken?.(stripThinking(content).answer, tokens);
        }
        if (choice?.finish_reason) doneReason = choice.finish_reason;
        if (chunk.usage) {
          promptTokens = chunk.usage.prompt_tokens ?? null;
          outputTokens = chunk.usage.completion_tokens ?? null;
        }
      }
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw mapError(error);
    }
    const split = stripThinking(content);
    const allThinking = [thinking.trim(), split.thinking].filter(Boolean).join("\n\n");
    return { content: split.answer, thinking: allThinking || null, model: req.model, promptTokens, outputTokens, doneReason };
  }

  async embed(model: string, inputs: string[], options?: { signal?: AbortSignal }): Promise<number[][]> {
    const { res } = await aiFetch(`${this.baseUrl}/embeddings`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({ model, input: inputs }),
      signal: options?.signal,
      timeoutMs: Math.min(config.requestTimeoutMs, 300_000),
      providerKind: this.kind,
      baseUrl: this.baseUrl,
    });
    if (!res.ok) throw aiErrors.upstream(await readErrorText(res));
    const data = (await res.json()) as { data?: { embedding: number[]; index?: number }[] };
    const rows = [...(data.data ?? [])].sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
    if (rows.length !== inputs.length) throw aiErrors.invalidOutput("embedding count mismatch");
    return rows.map((r) => r.embedding);
  }
}
