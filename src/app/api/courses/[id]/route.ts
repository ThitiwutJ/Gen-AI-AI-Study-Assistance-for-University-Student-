import { z } from "zod";
import { deleteCourse, updateCourse } from "@/lib/data/courses";
import { handle, idParam, notFound, readJson } from "@/lib/http";

export const PATCH = handle(async (request: Request, ctx: RouteContext<"/api/courses/[id]">) => {
  const id = await idParam(ctx.params);
  const body = await readJson(request, z.object({ name: z.string().max(120).optional(), code: z.string().max(40).nullish() }));
  const course = updateCourse(id, body);
  if (!course) throw notFound("Course");
  return course;
});

export const DELETE = handle(async (_request: Request, ctx: RouteContext<"/api/courses/[id]">) => {
  const id = await idParam(ctx.params);
  if (!deleteCourse(id)) throw notFound("Course");
  return { ok: true };
});
