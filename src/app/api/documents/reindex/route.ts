import { z } from "zod";
import { invalidateStatus } from "@/lib/ai/service";
import { handle, readJson } from "@/lib/http";
import { reindexDocuments } from "@/lib/retrieval/indexer";

export const POST = handle(async (request: Request) => {
  const body = await readJson(request, z.object({ documentId: z.number().int().positive().optional(), all: z.boolean().optional() }));
  const queued = reindexDocuments(body);
  invalidateStatus();
  return { queued };
});
