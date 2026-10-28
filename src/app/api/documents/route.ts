import { z } from "zod";
import { ingestDocument } from "@/lib/documents/ingest";
import { listDocuments } from "@/lib/documents/repo";
import { AppError } from "@/lib/errors";
import { handle, readJson } from "@/lib/http";

export const dynamic = "force-dynamic";

export const GET = handle(async (request: Request) => {
  const url = new URL(request.url);
  const course = url.searchParams.get("courseId");
  return listDocuments({ courseId: course ? Number.parseInt(course, 10) : undefined, q: url.searchParams.get("q") ?? undefined });
});

function optionalId(value: FormDataEntryValue | null): number | null {
  if (typeof value !== "string" || !value) return null;
  const n = Number.parseInt(value, 10);
  return Number.isInteger(n) && n > 0 ? n : null;
}

const Paste = z.object({
  title: z.string().max(200).optional(),
  description: z.string().max(2000).nullish(),
  courseId: z.number().int().positive().nullish(),
  pastedText: z.string().min(1).max(2_000_000),
});

/** Upload a file (multipart/form-data) or paste notes (JSON). */
export const POST = handle(async (request: Request) => {
  const type = request.headers.get("content-type") ?? "";
  if (type.includes("application/json")) {
    const body = await readJson(request, Paste);
    return ingestDocument({ title: body.title, description: body.description, courseId: body.courseId, pastedText: body.pastedText });
  }
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    throw new AppError("invalid_input", "The upload couldn't be read. Try again.", 400);
  }
  const file = form.get("file");
  if (!(file instanceof File)) throw new AppError("invalid_input", "Choose a file to upload.", 400);
  const buffer = Buffer.from(await file.arrayBuffer());
  return ingestDocument({
    file: { name: file.name, buffer },
    title: typeof form.get("title") === "string" ? (form.get("title") as string) : undefined,
    description: typeof form.get("description") === "string" ? (form.get("description") as string) : undefined,
    courseId: optionalId(form.get("courseId")),
  });
});
