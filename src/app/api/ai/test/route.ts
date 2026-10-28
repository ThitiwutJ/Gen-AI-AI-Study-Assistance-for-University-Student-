import { generate, invalidateStatus } from "@/lib/ai/service";
import { handle } from "@/lib/http";

export const dynamic = "force-dynamic";

/** Sends a tiny real prompt to the selected local model and reports how long it took. */
export const POST = handle(async () => {
  invalidateStatus();
  const started = Date.now();
  const result = await generate({
    messages: [{ role: "user", content: "Reply with exactly one short sentence confirming you are working." }],
    numPredict: 40,
    temperature: 0,
  });
  return {
    ok: true,
    model: result.model,
    reply: result.content.slice(0, 300),
    ms: Date.now() - started,
    promptTokens: result.promptTokens,
    numCtx: result.numCtx,
  };
});
