import { NextResponse } from "next/server";
import { z } from "zod";
import { AppError, toErrorBody } from "@/lib/errors";

/** Wrap a route handler: consistent JSON errors, no stack traces sent to the browser. */
export function handle<A extends unknown[]>(fn: (...args: A) => Promise<Response | unknown> | Response | unknown) {
  return async (...args: A): Promise<Response> => {
    try {
      const result = await fn(...args);
      if (result instanceof Response) return result;
      return NextResponse.json(result ?? { ok: true });
    } catch (error) {
      const { status, body } = toErrorBody(error);
      return NextResponse.json(body, { status });
    }
  };
}

export async function readJson<T>(request: Request, schema: z.ZodType<T>): Promise<T> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    throw new AppError("invalid_input", "The request body must be JSON.", 400);
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new AppError("invalid_input", `Invalid ${issue.path.join(".") || "input"}: ${issue.message}`, 400);
  }
  return parsed.data;
}

export async function idParam(params: Promise<Record<string, string | string[]>>, key = "id"): Promise<number> {
  const value = (await params)[key];
  const id = Number.parseInt(Array.isArray(value) ? value[0] : value, 10);
  if (!Number.isInteger(id) || id <= 0) throw new AppError("not_found", "Not found.", 404);
  return id;
}

export function notFound(what: string): AppError {
  return new AppError("not_found", `${what} wasn't found. It may have been deleted.`, 404);
}

export const zLanguage = z.enum(["auto", "en", "th"]);
export const zLevel = z.enum(["beginner", "standard", "exam"]);
