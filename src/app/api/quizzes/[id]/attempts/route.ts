import { z } from "zod";
import { startAttemptJob } from "@/lib/features/quizzes";
import { handle, idParam, readJson } from "@/lib/http";

/** Submit answers. Returns a job (short answers are graded by the local model); result is { attemptId }. */
export const POST = handle(async (request: Request, ctx: RouteContext<"/api/quizzes/[id]/attempts">) => {
  const id = await idParam(ctx.params);
  const body = await readJson(request, z.object({ answers: z.record(z.string(), z.string().max(4000)) }));
  return startAttemptJob(id, body.answers);
});
