/** Errors with a stable code, a plain-language message and (when useful) a fix. */
export class AppError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status = 400,
    public readonly fix?: string,
  ) {
    super(message);
    this.name = "AppError";
  }
}

const OLLAMA_START_FIX =
  "Start Ollama: on Windows open “Ollama” from the Start menu (it runs in the system tray), or run `ollama serve` in a terminal. Then click “Check again”.";

export const aiErrors = {
  notRunning(baseUrl: string, provider: "ollama" | "openai-compatible" = "ollama") {
    return new AppError(
      "ai_not_running",
      provider === "ollama"
        ? `The local AI service (Ollama) isn't responding at ${baseUrl}. AI features need it to be running.`
        : `The AI server at ${baseUrl} isn't responding.`,
      503,
      provider === "ollama" ? OLLAMA_START_FIX : "Start your OpenAI-compatible server, or check OPENAI_COMPAT_BASE_URL in .env.local.",
    );
  },
  modelMissing(model: string) {
    return new AppError(
      "model_missing",
      `The model “${model}” isn't installed in Ollama.`,
      409,
      `Choose an installed model in Settings, or install it with: ollama pull ${model}`,
    );
  },
  noChatModel() {
    return new AppError(
      "no_chat_model",
      "No chat model is installed, so AI features can't run yet.",
      409,
      "Install one with `ollama pull <model>` (for example a small multilingual model), then open Settings and click “Check again”.",
    );
  },
  modelCrashed(model: string, detail: string) {
    return new AppError(
      "model_crashed",
      `Ollama crashed while loading “${model}” (${detail.slice(0, 120)}).`,
      502,
      "This is usually a graphics-driver problem: the installed Ollama needs a newer GPU driver. Update your NVIDIA/AMD driver, or start Gen AI with `npm start`, which switches Ollama to CPU mode automatically when the GPU fails.",
    );
  },
  timeout(seconds: number) {
    return new AppError(
      "ai_timeout",
      `The AI model didn't finish within ${seconds} seconds.`,
      504,
      "Local models can be slow on laptops. Try again, ask a shorter question, select fewer documents, or lower the context window in Settings.",
    );
  },
  cancelled() {
    return new AppError("cancelled", "The request was cancelled.", 499);
  },
  invalidOutput(detail: string) {
    return new AppError(
      "invalid_ai_output",
      `The model's answer wasn't in the expected format (${detail}).`,
      502,
      "Try again. Small models sometimes struggle with structured output; a larger model usually fixes this.",
    );
  },
  upstream(message: string) {
    return new AppError("ai_error", `The AI model returned an error: ${message}`, 502);
  },
};

export function toErrorBody(error: unknown): { status: number; body: { error: { code: string; message: string; fix?: string } } } {
  if (error instanceof AppError) {
    return { status: error.status, body: { error: { code: error.code, message: error.message, fix: error.fix } } };
  }
  console.error("[gen-ai] unexpected error:", error);
  return {
    status: 500,
    body: { error: { code: "internal_error", message: "Something went wrong on the server. Check the terminal running Gen AI for details." } },
  };
}
