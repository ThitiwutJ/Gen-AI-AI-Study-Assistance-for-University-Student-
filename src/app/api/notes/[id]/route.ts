import { z } from "zod";
import { deleteNote, getNote, updateNote } from "@/lib/data/notes";
import { handle, idParam, notFound, readJson } from "@/lib/http";

export const dynamic = "force-dynamic";

export const GET = handle(async (_request: Request, ctx: RouteContext<"/api/notes/[id]">) => {
  const note = getNote(await idParam(ctx.params));
  if (!note) throw notFound("Note");
  return note;
});

export const PATCH = handle(async (request: Request, ctx: RouteContext<"/api/notes/[id]">) => {
  const id = await idParam(ctx.params);
  const body = await readJson(request, z.object({ title: z.string().max(200).optional(), content: z.string().max(500_000).optional() }));
  const note = updateNote(id, body);
  if (!note) throw notFound("Note");
  return note;
});

export const DELETE = handle(async (_request: Request, ctx: RouteContext<"/api/notes/[id]">) => {
  if (!deleteNote(await idParam(ctx.params))) throw notFound("Note");
  return { ok: true };
});
