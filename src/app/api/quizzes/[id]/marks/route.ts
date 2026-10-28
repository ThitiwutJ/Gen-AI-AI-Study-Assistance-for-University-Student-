import { z } from "zod";
import { getQuiz, setFlashcardMark } from "@/lib/data/quizzes";
import { handle, idParam, notFound, readJson } from "@/lib/http";

/** Mark / unmark a flashcard for further review. */
export const POST = handle(async (request: Request, ctx: RouteContext<"/api/quizzes/[id]/marks">) => {
  const id = await idParam(ctx.params);
  const body = await readJson(request, z.object({ questionId: z.string().max(20), marked: z.boolean() }));
  if (!getQuiz(id)) throw notFound("Quiz");
  setFlashcardMark(id, body.questionId, body.marked);
  return { ok: true };
});
