import { z } from "zod";
import { deleteConversation, getConversation, updateConversation } from "@/lib/data/conversations";
import { handle, idParam, notFound, readJson } from "@/lib/http";

export const dynamic = "force-dynamic";

export const GET = handle(async (_request: Request, ctx: RouteContext<"/api/conversations/[id]">) => {
  const conversation = getConversation(await idParam(ctx.params));
  if (!conversation) throw notFound("Conversation");
  return conversation;
});

export const PATCH = handle(async (request: Request, ctx: RouteContext<"/api/conversations/[id]">) => {
  const id = await idParam(ctx.params);
  const body = await readJson(request, z.object({ title: z.string().min(1).max(200) }));
  if (!getConversation(id)) throw notFound("Conversation");
  updateConversation(id, { title: body.title });
  return getConversation(id);
});

export const DELETE = handle(async (_request: Request, ctx: RouteContext<"/api/conversations/[id]">) => {
  if (!deleteConversation(await idParam(ctx.params))) throw notFound("Conversation");
  return { ok: true };
});
