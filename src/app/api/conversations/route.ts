import { z } from "zod";
import { createConversation, listConversations } from "@/lib/data/conversations";
import { handle, readJson, zLanguage, zLevel } from "@/lib/http";

export const dynamic = "force-dynamic";

export const GET = handle(async (request: Request) => listConversations(100, new URL(request.url).searchParams.get("q") ?? undefined));

export const POST = handle(async (request: Request) => {
  const body = await readJson(
    request,
    z.object({
      scope: z.enum(["none", "all", "course", "documents"]).optional(),
      courseId: z.number().int().positive().nullish(),
      documentIds: z.array(z.number().int().positive()).max(50).optional(),
      level: zLevel.optional(),
      language: zLanguage.optional(),
    }),
  );
  return createConversation(body);
});
