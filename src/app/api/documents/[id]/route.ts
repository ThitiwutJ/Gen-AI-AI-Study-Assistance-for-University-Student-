import { z } from "zod";
import { deleteDocument, getDocumentDetail, touchDocument, updateDocument } from "@/lib/documents/repo";
import { handle, idParam, notFound, readJson } from "@/lib/http";

export const dynamic = "force-dynamic";

export const GET = handle(async (request: Request, ctx: RouteContext<"/api/documents/[id]">) => {
  const id = await idParam(ctx.params);
  const doc = getDocumentDetail(id);
  if (!doc) throw notFound("Material");
  if (new URL(request.url).searchParams.get("touch") === "1") touchDocument(id);
  return doc;
});

export const PATCH = handle(async (request: Request, ctx: RouteContext<"/api/documents/[id]">) => {
  const id = await idParam(ctx.params);
  const body = await readJson(
    request,
    z.object({ title: z.string().min(1).max(200).optional(), description: z.string().max(2000).nullish(), courseId: z.number().int().positive().nullish() }),
  );
  const doc = updateDocument(id, { title: body.title?.trim(), description: body.description === undefined ? undefined : body.description?.trim() || null, courseId: body.courseId === undefined ? undefined : body.courseId });
  if (!doc) throw notFound("Material");
  return doc;
});

export const DELETE = handle(async (_request: Request, ctx: RouteContext<"/api/documents/[id]">) => {
  const id = await idParam(ctx.params);
  if (!deleteDocument(id)) throw notFound("Material");
  return { ok: true };
});
