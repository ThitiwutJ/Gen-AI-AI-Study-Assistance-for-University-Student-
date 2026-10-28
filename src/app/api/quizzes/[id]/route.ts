import { z } from "zod";
import { deleteQuiz, getQuiz, renameQuiz } from "@/lib/data/quizzes";
import { handle, idParam, notFound, readJson } from "@/lib/http";

export const dynamic = "force-dynamic";

export const GET = handle(async (_request: Request, ctx: RouteContext<"/api/quizzes/[id]">) => {
  const quiz = getQuiz(await idParam(ctx.params));
  if (!quiz) throw notFound("Quiz");
  return quiz;
});

export const PATCH = handle(async (request: Request, ctx: RouteContext<"/api/quizzes/[id]">) => {
  const id = await idParam(ctx.params);
  const body = await readJson(request, z.object({ title: z.string().min(1).max(200) }));
  if (!getQuiz(id)) throw notFound("Quiz");
  renameQuiz(id, body.title);
  return getQuiz(id);
});

export const DELETE = handle(async (_request: Request, ctx: RouteContext<"/api/quizzes/[id]">) => {
  if (!deleteQuiz(await idParam(ctx.params))) throw notFound("Quiz");
  return { ok: true };
});
