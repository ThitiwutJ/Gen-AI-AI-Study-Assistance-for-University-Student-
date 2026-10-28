import { aiErrors, AppError } from "@/lib/errors";
import { config } from "@/lib/config";
import { aiFetch, readErrorText, readLines } from "./http";
import { stripThinking } from "./think";
import type { AIProvider, ChatRequest, ChatResult, ProviderModel } from "./types";

/**
 * Ollama provider using the native local API (docs.ollama.com):
 *   GET /api/version, GET /api/tags, POST /api/show, GET /api/ps, POST /api/chat, POST /api/embed
 * Chat always streams internally (and accumulates), so long local generations never hit
 * HTTP header timeouts, and the UI can show real progress.
 */

interface TagsResponse {
  models?: { name: string; model?: string; size?: number; digest?: string; details?: { family?: string; parameter_size?: string } }[];
}

interface ShowResponse {
  capabilities?: string[];
  model_info?: Record<string, unknown>;
  details?: { family?: string; parameter_size?: string };
  thinking?: { values?: string[]; default?: string };
}

const EMBED_NAME = /(embed|bge-|bge$|minilm|e5-|gte-|nomic-embed|arctic-embed|paraphrase-multilingual)/i;

type ShowCache = Map<string, { at: number; data: ShowResponse | null }>;
const g = globalThis as typeof globalThis & { __genaiShowCache?: ShowCache };
const showCache: ShowCache = (g.__genaiShowCache ??= new Map());

export class OllamaProvider implements AIProvider {
  readonly kind = "ollama" as const;
  readonly supportsNumCtx = true;
  constructor(readonly baseUrl: string = config.ollama.baseUrl) {}

  private async get<T>(path: string, timeoutMs = 4000): Promise<T> {
    const { res } = await aiFetch(`${this.baseUrl}${path}`, { timeoutMs, providerKind: "ollama", baseUrl: this.baseUrl });
    if (!res.ok) throw aiErrors.upstream(await readErrorText(res));
    return (await res.json()) as T;
  }

  async version(): Promise<string | null> {
    try {
      const v = await this.get<{ version?: string }>("/api/version");
      return v.version ?? null;
    } catch {
      return null;
    }
  }

  private async show(name: string, digest: string | undefined): Promise<ShowResponse | null> {
    const key = `${name}@${digest ?? ""}`;
    const cached = showCache.get(key);
    if (cached && Date.now() - cached.at < 10 * 60_000) return cached.data;
    try {
      const { res } = await aiFetch(`${this.baseUrl}/api/show`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model: name }),
        timeoutMs: 8000,
        providerKind: "ollama",
        baseUrl: this.baseUrl,
      });
      const data = res.ok ? ((await res.json()) as ShowResponse) : null;
      showCache.set(key, { at: Date.now(), data });
      return data;
    } catch {
      return null;
    }
  }

  async listModels(): Promise<ProviderModel[]> {
    const tags = await this.get<TagsResponse>("/api/tags");
    const models = tags.models ?? [];
    return Promise.all(
      models.map(async (m) => {
        const info = await this.show(m.name, m.digest);
        const capabilities = info?.capabilities ?? [];
        const arch = typeof info?.model_info?.["general.architecture"] === "string" ? (info.model_info["general.architecture"] as string) : null;
        const ctxRaw = arch ? info?.model_info?.[`${arch}.context_length`] : undefined;
        const contextLength = typeof ctxRaw === "number" ? ctxRaw : null;
        const isEmbedding =
          capabilities.includes("embedding") ||
          (capabilities.length > 0 && !capabilities.includes("completion")) ||
          (capabilities.length === 0 && EMBED_NAME.test(m.name));
        return {
          name: m.name,
          sizeBytes: m.size ?? null,
          parameterSize: m.details?.parameter_size ?? info?.details?.parameter_size ?? null,
          family: m.details?.family ?? info?.details?.family ?? null,
          capabilities,
          contextLength,
          isEmbedding,
          thinking: capabilities.includes("thinking"),
          thinkingLevels: info?.thinking?.values ?? [],
        } satisfies ProviderModel;
      }),
    );
  }

  async loadedModels(): Promise<string[]> {
    try {
      const ps = await this.get<{ models?: { name: string }[] }>("/api/ps");
      return (ps.models ?? []).map((m) => m.name);
    } catch {
      return [];
    }
  }

  async chat(req: ChatRequest): Promise<ChatResult> {
    const body: Record<string, unknown> = {
      model: req.model,
      messages: req.messages,
      stream: true,
      keep_alive: config.ollama.keepAlive,
      options: {
        num_ctx: req.numCtx, // Always explicit: Ollama's default is small and truncates silently.
        ...(req.numPredict ? { num_predict: req.numPredict } : {}),
        ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
      },
    };
    if (req.format) body.format = req.format;
    if (req.think !== undefined) body.think = req.think;

    const { res, mapError } = await aiFetch(`${this.baseUrl}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: req.signal,
      providerKind: "ollama",
      baseUrl: this.baseUrl,
    });

    if (!res.ok) {
      const message = await readErrorText(res);
      if (res.status === 404 || /not found/i.test(message)) throw aiErrors.modelMissing(req.model);
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
        let chunk: {
          message?: { content?: string; thinking?: string };
          done?: boolean;
          done_reason?: string;
          prompt_eval_count?: number;
          eval_count?: number;
          error?: string;
        };
        try {
          chunk = JSON.parse(line);
        } catch {
          continue;
        }
        if (chunk.error) throw aiErrors.upstream(chunk.error);
        const piece = chunk.message?.content ?? "";
        const thought = chunk.message?.thinking ?? "";
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
        if (chunk.done) {
          promptTokens = chunk.prompt_eval_count ?? null;
          outputTokens = chunk.eval_count ?? null;
          doneReason = chunk.done_reason ?? null;
        }
      }
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw mapError(error);
    }

    const split = stripThinking(content);
    const allThinking = [thinking.trim(), split.thinking].filter(Boolean).join("\n\n");
    return {
      content: split.answer,
      thinking: allThinking || null,
      model: req.model,
      promptTokens,
      outputTokens,
      doneReason,
    };
  }

  async embed(model: string, inputs: string[], options?: { numCtx?: number; signal?: AbortSignal }): Promise<number[][]> {
    const { res } = await aiFetch(`${this.baseUrl}/api/embed`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model,
        input: inputs,
        keep_alive: config.ollama.keepAlive,
        ...(options?.numCtx ? { options: { num_ctx: options.numCtx } } : {}),
      }),
      signal: options?.signal,
      timeoutMs: Math.min(config.requestTimeoutMs, 300_000),
      providerKind: "ollama",
      baseUrl: this.baseUrl,
    });
    if (!res.ok) {
      const message = await readErrorText(res);
      if (res.status === 404 || /not found/i.test(message)) throw aiErrors.modelMissing(model);
      throw aiErrors.upstream(message);
    }
    const data = (await res.json()) as { embeddings?: number[][] };
    if (!Array.isArray(data.embeddings) || data.embeddings.length !== inputs.length) {
      throw aiErrors.invalidOutput("embedding count mismatch");
    }
    return data.embeddings;
  }
}
