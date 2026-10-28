import { config } from "@/lib/config";
import { getDb } from "@/lib/db";
import { aiErrors, AppError } from "@/lib/errors";
import { getSettings } from "@/lib/settings";
import type { AIProblem, AIStatus, ModelView } from "@/lib/types";
import { OllamaProvider } from "./ollama";
import { OpenAICompatibleProvider } from "./openai-compatible";
import type { AIProvider, ChatMessage, ChatResult, ProviderModel } from "./types";

/**
 * The single AI service layer every feature goes through. It owns:
 *  - which provider to talk to (Ollama by default),
 *  - which installed chat / embedding model to use (settings → env → automatic choice),
 *  - the effective context window (num_ctx) sent with every request,
 *  - how "thinking" models are handled.
 */

type G = typeof globalThis & { __genaiProvider?: AIProvider; __genaiStatus?: { at: number; status: AIStatus } };
const g = globalThis as G;

export function getProvider(): AIProvider {
  if (!g.__genaiProvider) {
    g.__genaiProvider = config.provider === "openai-compatible" ? new OpenAICompatibleProvider() : new OllamaProvider();
  }
  return g.__genaiProvider;
}

/** For tests. */
export function setProviderForTests(provider: AIProvider | undefined): void {
  g.__genaiProvider = provider;
  g.__genaiStatus = undefined;
}

export function invalidateStatus(): void {
  g.__genaiStatus = undefined;
}

function normalizeName(name: string): string {
  return name.includes(":") ? name : `${name}:latest`;
}

function findModel(models: ProviderModel[], name: string): ProviderModel | undefined {
  return models.find((m) => m.name === name) ?? models.find((m) => normalizeName(m.name) === normalizeName(name));
}

function paramsInBillions(m: ProviderModel): number | null {
  const match = m.parameterSize?.match(/([\d.]+)\s*([MBK])/i);
  if (!match) return null;
  const n = Number.parseFloat(match[1]);
  const unit = match[2].toUpperCase();
  return unit === "B" ? n : unit === "M" ? n / 1000 : n / 1_000_000;
}

/** Prefer a laptop-friendly 3–10B model; otherwise the largest smaller one; otherwise the smallest larger one. */
export function pickChatModel(models: ProviderModel[]): ProviderModel | undefined {
  const chat = models.filter((m) => !m.isEmbedding);
  if (!chat.length) return undefined;
  const sized = chat.map((m) => ({ m, b: paramsInBillions(m) ?? 0 }));
  const mid = sized.filter((x) => x.b >= 3 && x.b <= 10).sort((a, b) => b.b - a.b);
  if (mid.length) return mid[0].m;
  const small = sized.filter((x) => x.b < 3).sort((a, b) => b.b - a.b);
  if (small.length) return small[0].m;
  return sized.sort((a, b) => a.b - b.b)[0].m;
}

const MULTILINGUAL_EMBED = [/qwen3-embedding/i, /bge-m3/i, /arctic-embed2/i, /paraphrase-multilingual/i, /embeddinggemma/i, /granite-embedding/i];

export function pickEmbedModel(models: ProviderModel[]): ProviderModel | undefined {
  const embed = models.filter((m) => m.isEmbedding);
  for (const pattern of MULTILINGUAL_EMBED) {
    const hit = embed.find((m) => pattern.test(m.name));
    if (hit) return hit;
  }
  return embed[0];
}

export interface ResolvedModels {
  models: ProviderModel[];
  chat: ProviderModel | null;
  chatSource: AIStatus["chat"]["source"];
  chatRequested: string | null;
  embed: ProviderModel | null;
  embedSource: AIStatus["embed"]["source"];
  embedRequested: string | null;
  numCtx: number;
}

function envChatModel(): string | undefined {
  return config.provider === "ollama" ? config.ollama.model : config.openaiCompatible.model;
}
function envEmbedModel(): string | undefined {
  return config.provider === "ollama" ? config.ollama.embedModel : config.openaiCompatible.embedModel;
}

/** Throws ai_not_running if the provider can't be reached. */
export async function resolveModels(): Promise<ResolvedModels> {
  const settings = getSettings();
  const models = await getProvider().listModels();

  let chat: ProviderModel | null = null;
  let chatSource: ResolvedModels["chatSource"] = null;
  let chatRequested: string | null = null;
  if (settings.chatModel) {
    chatRequested = settings.chatModel;
    chatSource = "settings";
    chat = findModel(models, settings.chatModel) ?? null;
  } else if (envChatModel()) {
    chatRequested = envChatModel()!;
    chatSource = "env";
    chat = findModel(models, chatRequested) ?? null;
  } else {
    chat = pickChatModel(models) ?? null;
    chatSource = chat ? "auto" : null;
  }

  let embed: ProviderModel | null = null;
  let embedSource: ResolvedModels["embedSource"] = null;
  let embedRequested: string | null = null;
  if (settings.embedModel === "none") {
    embedSource = "off";
  } else if (settings.embedModel) {
    embedRequested = settings.embedModel;
    embedSource = "settings";
    embed = findModel(models, settings.embedModel) ?? null;
  } else if (envEmbedModel()) {
    embedRequested = envEmbedModel()!;
    embedSource = "env";
    embed = findModel(models, embedRequested) ?? null;
  } else {
    embed = pickEmbedModel(models) ?? null;
    embedSource = embed ? "auto" : null;
  }

  const max = chat?.contextLength ?? null;
  const numCtx = max ? Math.min(settings.numCtx, max) : settings.numCtx;
  return { models, chat, chatSource, chatRequested, embed, embedSource, embedRequested, numCtx };
}

function toView(m: ProviderModel): ModelView {
  return {
    name: m.name,
    sizeBytes: m.sizeBytes,
    parameterSize: m.parameterSize,
    family: m.family,
    capabilities: m.capabilities,
    contextLength: m.contextLength,
    isEmbedding: m.isEmbedding,
    thinking: m.thinking,
  };
}

function countDocsNeedingIndex(embedModel: string | null): number {
  if (!embedModel) return 0;
  const row = getDb()
    .prepare(
      `SELECT COUNT(*) AS n FROM documents
       WHERE searchable = 1 AND chunk_count > 0
         AND (index_status != 'ready' OR embed_model IS NULL OR embed_model != ?)`,
    )
    .get<{ n: number }>(embedModel);
  return row?.n ?? 0;
}

export async function getStatus(force = false): Promise<AIStatus> {
  const cached = g.__genaiStatus;
  if (!force && cached && Date.now() - cached.at < 4000) return cached.status;

  const provider = getProvider();
  const settings = getSettings();
  const problems: AIProblem[] = [];
  let status: AIStatus;

  try {
    const r = await resolveModels();
    const [version, loaded] = await Promise.all([provider.version(), provider.loadedModels()]);
    let state: AIStatus["state"] = "connected";

    if (!r.models.length) {
      state = "no_models";
      problems.push({
        code: "no_models",
        message: "Ollama is running but no models are installed.",
        fix: "Install a chat model, for example: ollama pull gemma3:4b — then click “Check again”.",
      });
    } else if (!r.chat && r.chatRequested) {
      state = "model_unavailable";
      problems.push({
        code: "model_missing",
        message: `The selected chat model “${r.chatRequested}” isn't installed.`,
        fix: `Pick an installed model below, or install it with: ollama pull ${r.chatRequested}`,
      });
    } else if (!r.chat) {
      state = "no_models";
      problems.push({
        code: "no_chat_model",
        message: "Only embedding models are installed — there is no chat model for answering questions.",
        fix: "Install a chat model, for example: ollama pull gemma3:4b",
      });
    }

    if (r.embedRequested && !r.embed) {
      problems.push({
        code: "embed_missing",
        message: `The selected embedding model “${r.embedRequested}” isn't installed, so search uses keywords only.`,
        fix: `Choose another embedding model, or install it with: ollama pull ${r.embedRequested}`,
      });
    } else if (!r.embed && r.embedSource !== "off") {
      problems.push({
        code: "no_embed_model",
        message: "Semantic search is off — install an embedding model for better results. Keyword search still works.",
        fix: "A multilingual embedding model handles English and Thai, for example: ollama pull qwen3-embedding:0.6b",
      });
    }

    status = {
      provider: provider.kind,
      baseUrl: provider.baseUrl,
      state,
      version,
      models: r.models.map(toView),
      chat: {
        model: r.chat?.name ?? r.chatRequested,
        source: r.chatSource,
        available: Boolean(r.chat),
        contextLength: r.chat?.contextLength ?? null,
        thinking: Boolean(r.chat?.thinking),
      },
      embed: {
        model: r.embed?.name ?? r.embedRequested,
        source: r.embedSource,
        available: Boolean(r.embed),
        mode: r.embed ? "semantic" : "keyword",
      },
      loadedModels: loaded,
      numCtx: r.numCtx,
      problems,
      staleDocuments: countDocsNeedingIndex(r.embed?.name ?? null),
      checkedAt: new Date().toISOString(),
    };
  } catch (error) {
    const err = error instanceof AppError ? error : aiErrors.notRunning(provider.baseUrl, provider.kind);
    status = {
      provider: provider.kind,
      baseUrl: provider.baseUrl,
      state: err.code === "ai_not_running" ? "not_running" : "error",
      version: null,
      models: [],
      chat: { model: settings.chatModel || envChatModel() || null, source: null, available: false, contextLength: null, thinking: false },
      embed: { model: null, source: null, available: false, mode: "keyword" },
      loadedModels: [],
      numCtx: settings.numCtx,
      problems: [{ code: err.code, message: err.message, fix: err.fix }],
      staleDocuments: 0,
      checkedAt: new Date().toISOString(),
    };
  }

  g.__genaiStatus = { at: Date.now(), status };
  return status;
}

export interface GenerateOptions {
  messages: ChatMessage[];
  /** Tokens reserved for the answer. */
  numPredict: number;
  temperature?: number;
  format?: Record<string, unknown>;
  signal?: AbortSignal;
  onToken?: (partial: string, tokens: number) => void;
  onFirstToken?: () => void;
}

export interface GenerateResult extends ChatResult {
  numCtx: number;
}

/** Resolve the chat model and its context window, or throw a clear, actionable error. */
export async function requireChatModel(): Promise<{ model: ProviderModel; numCtx: number }> {
  const r = await resolveModels();
  if (!r.chat) {
    if (r.chatRequested) throw aiErrors.modelMissing(r.chatRequested);
    throw aiErrors.noChatModel();
  }
  return { model: r.chat, numCtx: r.numCtx };
}

function thinkValue(model: ProviderModel): boolean | string | undefined {
  if (!model.thinking) return undefined; // never send `think` to models that don't support it
  if (model.thinkingLevels.length) return model.thinkingLevels.includes("low") ? "low" : model.thinkingLevels[0];
  return false; // faster answers, and reasoning can never leak into answers or JSON
}

export async function generate(opts: GenerateOptions): Promise<GenerateResult> {
  const { model, numCtx } = await requireChatModel();
  const provider = getProvider();
  const result = await provider.chat({
    model: model.name,
    messages: opts.messages,
    numCtx,
    numPredict: opts.numPredict,
    temperature: opts.temperature,
    format: opts.format,
    think: thinkValue(model),
    signal: opts.signal,
    onToken: opts.onToken,
    onFirstToken: opts.onFirstToken,
  });
  if (result.promptTokens && result.promptTokens >= numCtx * 0.9) {
    console.warn(
      `[gen-ai] prompt used ${result.promptTokens} of ${numCtx} context tokens for ${model.name}; context may have been truncated.`,
    );
  }
  return { ...result, numCtx };
}

/** Effective context window without throwing (used for planning budgets). */
export async function currentNumCtx(): Promise<number> {
  try {
    return (await resolveModels()).numCtx;
  } catch {
    return getSettings().numCtx;
  }
}
