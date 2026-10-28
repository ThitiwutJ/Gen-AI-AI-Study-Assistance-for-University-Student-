import { estimateTokens, promptBudget } from "@/lib/ai/budget";
import { generate, requireChatModel } from "@/lib/ai/service";
import { createNote } from "@/lib/data/notes";
import { formatLocation } from "@/lib/documents/chunk";
import { getDocumentDetail } from "@/lib/documents/repo";
import { AppError } from "@/lib/errors";
import { startJob, type JobContext } from "@/lib/jobs";
import type { DocumentDetail, JobView, LanguagePref, NoteKind } from "@/lib/types";
import { combineSystemPrompt, NOTE_KIND_LABELS, partNotesSystemPrompt, resolveLanguage, summarySystemPrompt, type Lang } from "./prompts";

const OUTPUT_TOKENS: Record<NoteKind, number> = { quick: 700, beginner: 1400, topics: 1600, exam: 1800, detailed: 2000 };
const PART_OUTPUT = 900;

function unitWord(doc: DocumentDetail): string {
  return doc.unitKind === "page" ? "page" : doc.unitKind === "slide" ? "slide" : "section";
}

/**
 * Model output may reference pages/slides/sections. Keep references that point to units that
 * really exist in this document; remove anything else, so notes never show invented locations.
 */
export function sanitizeUnitRefs(text: string, validUnits: Set<number>, word: string): { text: string; removed: string[] } {
  const removed: string[] = [];
  const words = "p\\.|pp\\.|pages?|slides?|sections?|หน้า|สไลด์|ส่วน";
  const pattern = new RegExp(`\\s?[(\\[]\\s*(?:${words})\\s*(\\d+)(?:\\s*[–\\-]\\s*(\\d+))?\\s*[)\\]]`, "gi");
  const out = text.replace(pattern, (match, a: string, b?: string) => {
    const start = Number.parseInt(a, 10);
    const end = b ? Number.parseInt(b, 10) : start;
    if (validUnits.has(start) && validUnits.has(end) && end >= start) {
      return start === end ? ` (${word} ${start})` : ` (${word}s ${start}–${end})`;
    }
    removed.push(match.trim());
    return "";
  });
  return { text: out, removed };
}

function unitBlock(doc: DocumentDetail, unit: DocumentDetail["units"][number], word: string): string {
  return `[${word} ${unit.index}]\n${unit.text}`;
}

/** Group units into parts that fit the prompt budget; split a single oversized unit if needed. */
function planParts(doc: DocumentDetail, word: string, partBudget: number): { start: number; end: number; text: string }[] {
  const parts: { start: number; end: number; text: string }[] = [];
  let current: { start: number; end: number; blocks: string[]; tokens: number } | null = null;
  for (const unit of doc.units) {
    const block = unitBlock(doc, unit, word);
    const t = estimateTokens(block);
    if (t > partBudget) {
      if (current) parts.push({ start: current.start, end: current.end, text: current.blocks.join("\n\n") });
      current = null;
      // Split the long unit by characters, keeping the marker on each piece.
      const ratio = partBudget / t;
      const size = Math.max(500, Math.floor(unit.text.length * ratio * 0.9));
      for (let i = 0; i < unit.text.length; i += size) {
        parts.push({ start: unit.index, end: unit.index, text: `[${word} ${unit.index}]\n${unit.text.slice(i, i + size)}` });
      }
      continue;
    }
    if (current && current.tokens + t > partBudget) {
      parts.push({ start: current.start, end: current.end, text: current.blocks.join("\n\n") });
      current = null;
    }
    if (!current) current = { start: unit.index, end: unit.index, blocks: [], tokens: 0 };
    current.blocks.push(block);
    current.end = unit.index;
    current.tokens += t;
  }
  if (current) parts.push({ start: current.start, end: current.end, text: current.blocks.join("\n\n") });
  return parts;
}

async function runSummary(ctx: JobContext, doc: DocumentDetail, kind: NoteKind, lang: Lang): Promise<{ content: string; model: string; staged: boolean; parts: number }> {
  const { numCtx } = await requireChatModel();
  const word = unitWord(doc);
  const finalOutput = OUTPUT_TOKENS[kind];
  const system = summarySystemPrompt(kind, lang, word);
  const fullText = doc.units.map((u) => unitBlock(doc, u, word)).join("\n\n");
  const singleBudget = promptBudget(numCtx, finalOutput) - estimateTokens(system) - 60;

  const call = async (sys: string, user: string, numPredict: number) =>
    generate({
      messages: [
        { role: "system", content: sys },
        { role: "user", content: user },
      ],
      numPredict,
      temperature: 0.3,
      signal: ctx.signal,
      onFirstToken: () => ctx.setStage("generating"),
      onToken: (partial, tokens) => ctx.setPartial(partial, tokens),
    });

  if (estimateTokens(fullText) <= singleBudget) {
    ctx.setStage("loading_model");
    ctx.setProgress(0, 1);
    const result = await call(system, `MATERIAL: ${doc.title}\n\n${fullText}`, finalOutput);
    ctx.setProgress(1, 1);
    return { content: result.content, model: result.model, staged: false, parts: 1 };
  }

  // Staged: notes per part, then combine (repeat combining if needed).
  const partSystem = partNotesSystemPrompt(lang, word);
  const partBudget = promptBudget(numCtx, PART_OUTPUT) - estimateTokens(partSystem) - 60;
  const parts = planParts(doc, word, partBudget);
  const total = parts.length + 1;
  let model = "";
  let notes: { label: string; text: string }[] = [];
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    ctx.setProgress(i, total);
    ctx.setStage(`part ${i + 1} of ${parts.length}`);
    const range = formatLocation(doc.unitKind, p.start, p.end, null);
    const result = await call(partSystem, `MATERIAL: ${doc.title} — part ${i + 1} of ${parts.length} (${range})\n\n${p.text}`, PART_OUTPUT);
    model = result.model;
    notes.push({ label: `Part ${i + 1} (${range})`, text: result.content });
  }

  const combineSystem = combineSystemPrompt(kind, lang, word);
  const combineBudget = promptBudget(numCtx, finalOutput) - estimateTokens(combineSystem) - 60;
  let round = 0;
  while (estimateTokens(notes.map((n) => `## ${n.label}\n${n.text}`).join("\n\n")) > combineBudget && notes.length > 1 && round < 4) {
    round++;
    ctx.setStage("condensing notes");
    const grouped: { label: string; text: string }[] = [];
    let batch: typeof notes = [];
    let used = 0;
    const flush = async () => {
      if (!batch.length) return;
      const result = await call(
        partNotesSystemPrompt(lang, word),
        `Condense these partial notes into one set, keeping every (${word} N) reference:\n\n${batch.map((n) => `## ${n.label}\n${n.text}`).join("\n\n")}`,
        PART_OUTPUT,
      );
      grouped.push({ label: batch.map((b) => b.label).join(" + "), text: result.content });
      batch = [];
      used = 0;
    };
    for (const n of notes) {
      const t = estimateTokens(`## ${n.label}\n${n.text}`);
      if (batch.length && used + t > combineBudget) await flush();
      batch.push(n);
      used += t;
    }
    await flush();
    notes = grouped;
  }

  ctx.setProgress(parts.length, total);
  ctx.setStage("combining");
  const result = await call(
    combineSystem,
    `MATERIAL: ${doc.title}\n\nPARTIAL NOTES:\n\n${notes.map((n) => `## ${n.label}\n${n.text}`).join("\n\n")}`,
    finalOutput,
  );
  ctx.setProgress(total, total);
  return { content: result.content, model: result.model || model, staged: true, parts: parts.length };
}

export function startSummaryJob(input: { documentId: number; kind: NoteKind; language: LanguagePref }): JobView<{ noteId: number }> {
  const doc = getDocumentDetail(input.documentId);
  if (!doc) throw new AppError("not_found", "That material no longer exists.", 404);
  if (!doc.searchable) {
    throw new AppError("unreadable_material", "This material's text couldn't be extracted reliably, so it can't be summarized.", 422, doc.warning ?? undefined);
  }
  if (!NOTE_KIND_LABELS[input.kind]) throw new AppError("invalid_input", "Choose a summary type.", 400);
  const lang = resolveLanguage(input.language, doc.units.slice(0, 5).map((u) => u.text).join(" "));

  return startJob("summary", async (ctx) => {
    const result = await runSummary(ctx, doc, input.kind, lang);
    const word = unitWord(doc);
    const valid = new Set(doc.units.map((u) => u.index));
    const cleaned = sanitizeUnitRefs(result.content, valid, word);
    const first = doc.units[0]?.index ?? 1;
    const last = doc.units[doc.units.length - 1]?.index ?? first;
    const footer = `\n\n---\n*Source: ${doc.title} (${formatLocation(doc.unitKind, first, last, null)}).*`;
    const note = createNote({
      title: `${NOTE_KIND_LABELS[input.kind]}: ${doc.title}`,
      kind: input.kind,
      content: `${cleaned.text.trim()}${footer}`,
      documentId: doc.id,
      courseId: doc.courseId,
      model: result.model,
      language: lang,
      meta: { staged: result.staged, parts: result.parts, removedRefs: cleaned.removed.length ? cleaned.removed : undefined, unitKind: doc.unitKind },
    });
    return { noteId: note.id };
  });
}
