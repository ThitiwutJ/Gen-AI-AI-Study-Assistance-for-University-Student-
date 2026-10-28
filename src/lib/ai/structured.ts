import { z } from "zod";
import { aiErrors } from "@/lib/errors";
import { generate, type GenerateOptions } from "./service";
import type { ChatMessage } from "./types";

/**
 * Structured output: the JSON schema (generated from the same zod schema we validate with)
 * is sent in Ollama's `format` field, so the model is constrained to valid JSON. We still
 * validate, because valid JSON can still be wrong. One controlled retry includes the error.
 */

export function extractJson(text: string): unknown {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start !== -1 && end > start) return JSON.parse(trimmed.slice(start, end + 1));
    throw new Error("no JSON object found");
  }
}

export function jsonSchemaFor(schema: z.ZodType): Record<string, unknown> {
  const json = z.toJSONSchema(schema, { target: "draft-7", unrepresentable: "any" }) as Record<string, unknown>;
  delete json.$schema;
  return json;
}

export interface StructuredOptions<T> extends Omit<GenerateOptions, "format" | "messages"> {
  messages: ChatMessage[];
  schema: z.ZodType<T>;
  /** Extra semantic checks after schema validation. Return problems to trigger the retry. */
  check?: (value: T) => string[];
}

export async function generateStructured<T>(opts: StructuredOptions<T>): Promise<{ value: T; model: string; attempts: number; problems: string[] }> {
  const format = jsonSchemaFor(opts.schema);
  let messages = opts.messages;
  let lastProblem = "";
  for (let attempt = 1; attempt <= 2; attempt++) {
    const result = await generate({ ...opts, messages, format, temperature: opts.temperature ?? 0.2 });
    let parsed: unknown;
    try {
      parsed = extractJson(result.content);
    } catch {
      lastProblem = "the reply was not valid JSON";
    }
    if (parsed !== undefined) {
      const validated = opts.schema.safeParse(parsed);
      if (validated.success) {
        const problems = opts.check?.(validated.data) ?? [];
        if (!problems.length || attempt === 2) {
          return { value: validated.data, model: result.model, attempts: attempt, problems };
        }
        lastProblem = problems.slice(0, 6).join("; ");
      } else {
        lastProblem = validated.error.issues
          .slice(0, 5)
          .map((i) => `${i.path.join(".") || "root"}: ${i.message}`)
          .join("; ");
      }
    }
    if (attempt === 1) {
      messages = [
        ...opts.messages,
        { role: "assistant", content: result.content.slice(0, 4000) },
        {
          role: "user",
          content: `Your previous JSON had problems: ${lastProblem}. Return the complete JSON again, fixing these problems. Output only JSON.`,
        },
      ];
    }
  }
  throw aiErrors.invalidOutput(lastProblem || "unknown problem");
}
