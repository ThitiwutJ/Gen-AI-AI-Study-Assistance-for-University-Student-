export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatRequest {
  model: string;
  messages: ChatMessage[];
  /** Context window in tokens. Always sent explicitly to Ollama (options.num_ctx). */
  numCtx: number;
  /** Maximum tokens to generate. */
  numPredict?: number;
  temperature?: number;
  /** JSON schema for structured output (Ollama `format`, OpenAI `response_format`). */
  format?: Record<string, unknown>;
  /** Only sent to models that support thinking. */
  think?: boolean | string;
  signal?: AbortSignal;
  /** Called as text arrives (content only, never reasoning). */
  onToken?: (partialContent: string, tokenCount: number) => void;
  /** Called once the model starts producing output (i.e. it has finished loading). */
  onFirstToken?: () => void;
}

export interface ChatResult {
  content: string;
  thinking: string | null;
  model: string;
  promptTokens: number | null;
  outputTokens: number | null;
  doneReason: string | null;
}

export interface ProviderModel {
  name: string;
  sizeBytes: number | null;
  parameterSize: string | null;
  family: string | null;
  capabilities: string[];
  contextLength: number | null;
  isEmbedding: boolean;
  thinking: boolean;
  thinkingLevels: string[];
}

export interface AIProvider {
  readonly kind: "ollama" | "openai-compatible";
  readonly baseUrl: string;
  /** True if the provider honours num_ctx (Ollama). */
  readonly supportsNumCtx: boolean;
  version(): Promise<string | null>;
  listModels(): Promise<ProviderModel[]>;
  loadedModels(): Promise<string[]>;
  chat(request: ChatRequest): Promise<ChatResult>;
  embed(model: string, inputs: string[], options?: { numCtx?: number; signal?: AbortSignal }): Promise<number[][]>;
}
