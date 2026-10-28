import { getAttempt } from "@/lib/data/quizzes";
import { handle, idParam, notFound } from "@/lib/http";

export const dynamic = "force-dynamic";

export const GET = handle(async (_request: Request, ctx: RouteContext<"/api/attempts/[id]">) => {
  const attempt = getAttempt(await idParam(ctx.params));
  if (!attempt) throw notFound("Quiz attempt");
  return attempt;
});
