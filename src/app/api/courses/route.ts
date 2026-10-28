import { z } from "zod";
import { createCourse, listCourses } from "@/lib/data/courses";
import { handle, readJson } from "@/lib/http";

export const dynamic = "force-dynamic";

export const GET = handle(async () => listCourses());

export const POST = handle(async (request: Request) => {
  const body = await readJson(request, z.object({ name: z.string().min(1).max(120), code: z.string().max(40).nullish() }));
  return createCourse(body.name, body.code);
});
