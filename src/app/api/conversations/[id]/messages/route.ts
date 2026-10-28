import { z } from "zod";
import { askTutor } from "@/lib/features/tutor";
import { handle, idParam, readJson, zLanguage, zLevel } from "@/lib/http";

/** Ask a question (or retry the last one). Returns a job to poll at /api/jobs/:id. */
export const POST = handle(async (request: Request, ctx: RouteContext<"/api/conversations/[id]/messages">) => {
  const id = await idParam(ctx.params);
  const body = await readJson(
    request,
    z.object({
      content: z.string().max(8000).optional(),
      retry: z.boolean().optional(),
      scope: z.enum(["none", "all", "course", "documents"]),
      courseId: z.number().int().positive().nullish(),
      documentIds: z.array(z.number().int().positive()).max(50).optional(),
      level: zLevel,
      language: zLanguage,
    }),
  );
  return askTutor(id, body);
});
