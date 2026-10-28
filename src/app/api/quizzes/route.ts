import { z } from "zod";
import { listQuizzes } from "@/lib/data/quizzes";
import { startQuizJob } from "@/lib/features/quizzes";
import { handle, readJson, zLanguage } from "@/lib/http";

export const dynamic = "force-dynamic";

export const GET = handle(async (request: Request) => listQuizzes({ q: new URL(request.url).searchParams.get("q") ?? undefined }));

/** Start generating a quiz. Returns a job; its result is { quizId }. */
export const POST = handle(async (request: Request) => {
  const body = await readJson(
    request,
    z.object({
      scope: z.enum(["documents", "course", "topic"]),
      documentIds: z.array(z.number().int().positive()).max(50).optional(),
      courseId: z.number().int().positive().nullish(),
      topic: z.string().max(300).nullish(),
      count: z.number().int().min(1).max(15),
      difficulty: z.enum(["easy", "medium", "hard"]),
      types: z.array(z.enum(["mcq", "tf", "short"])).min(1),
      language: zLanguage,
    }),
  );
  return startQuizJob(body);
});
