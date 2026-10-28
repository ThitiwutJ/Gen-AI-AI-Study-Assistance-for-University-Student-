import { z } from "zod";
import { listNotes } from "@/lib/data/notes";
import { startSummaryJob } from "@/lib/features/summaries";
import { handle, readJson, zLanguage } from "@/lib/http";

export const dynamic = "force-dynamic";

export const GET = handle(async (request: Request) => {
  const url = new URL(request.url);
  const doc = url.searchParams.get("documentId");
  return listNotes({ q: url.searchParams.get("q") ?? undefined, documentId: doc ? Number.parseInt(doc, 10) : undefined });
});

/** Start generating notes for a material. Returns a job; its result is { noteId }. */
export const POST = handle(async (request: Request) => {
  const body = await readJson(
    request,
    z.object({
      documentId: z.number().int().positive(),
      kind: z.enum(["quick", "detailed", "exam", "beginner", "topics"]),
      language: zLanguage,
    }),
  );
  return startSummaryJob(body);
});
