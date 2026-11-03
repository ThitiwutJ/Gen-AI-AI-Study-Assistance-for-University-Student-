import { estimateTokens } from "@/lib/ai/budget";
import { getDb } from "@/lib/db";
import { getDocumentsByIds, listDocuments } from "@/lib/documents/repo";
import type { DocumentSummary, SourceRef } from "@/lib/types";
import type { Scope } from "./search";

/**
 * The "document collection" the tutor can see: every material in the chosen scope with its
 * file name, size, index status and opening excerpt, labelled [D1], [D2]… Without this the
 * model only sees retrieved passages and can't answer "What papers are in my collection?".
 */

export interface CollectionEntry {
  label: string; // "D1"
  doc: DocumentSummary;
  status: string; // "Indexed · 111 chunks"
  opening: string; // first passage, whitespace-collapsed ("" if the text is unusable)
}

const TYPE_NAME: Record<string, string> = { pdf: "PDF", docx: "Word", pptx: "PowerPoint", txt: "text", md: "Markdown", paste: "pasted notes" };

export function unitCountText(doc: Pick<DocumentSummary, "unitKind" | "unitCount">): string {
  const word = doc.unitKind === "page" ? "page" : doc.unitKind === "slide" ? "slide" : "section";
  return `${doc.unitCount} ${word}${doc.unitCount === 1 ? "" : "s"}`;
}

function sizeText(bytes: number | null): string {
  if (!bytes) return "";
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** Index status in the same words the Materials page uses. */
export function indexStatusText(doc: DocumentSummary): string {
  const chunks = `${doc.chunkCount} chunk${doc.chunkCount === 1 ? "" : "s"}`;
  switch (doc.indexStatus) {
    case "ready":
      return `Indexed · ${chunks}`;
    case "keyword_only":
      return `Indexed for keyword search · ${chunks}`;
    case "indexing":
      return `Indexing (${doc.indexedChunks} of ${doc.chunkCount} chunks embedded; keyword search works)`;
    case "pending":
      return `Waiting to index · ${chunks} (keyword search works)`;
    case "stale":
      return `Needs re-indexing · ${chunks} (keyword search works)`;
    case "failed":
      return `Indexing failed · ${chunks} (keyword search works)`;
    case "skipped":
      return "Text unreadable, not used for answers";
  }
}

/** Every material in the scope (including unreadable ones, so the list is complete), oldest first. */
export function collectionDocuments(scope: Scope): DocumentSummary[] {
  let docs: DocumentSummary[];
  if (scope.documentIds?.length) docs = getDocumentsByIds(scope.documentIds);
  else if (scope.courseId) docs = listDocuments({ courseId: scope.courseId });
  else docs = listDocuments();
  return docs.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id - b.id);
}

/** The first passage of each document (its title page / introduction), collapsed to one line. */
export function openingExcerpts(docIds: number[], maxChars: number): Map<number, string> {
  const map = new Map<number, string>();
  if (!docIds.length || maxChars <= 0) return map;
  const rows = getDb()
    .prepare(
      `SELECT c.document_id AS doc, c.text FROM chunks c
       WHERE c.document_id IN (${docIds.map(() => "?").join(",")})
         AND c.position = (SELECT MIN(position) FROM chunks c2 WHERE c2.document_id = c.document_id)`,
    )
    .all<{ doc: number; text: string }>(...docIds);
  for (const r of rows) {
    const flat = r.text.replace(/\s+/g, " ").trim();
    map.set(r.doc, flat.length > maxChars ? `${flat.slice(0, maxChars).replace(/\s+\S*$/, "")}…` : flat);
  }
  return map;
}

export function buildCollection(scope: Scope, excerptChars: number): CollectionEntry[] {
  const docs = collectionDocuments(scope);
  const openings = openingExcerpts(
    docs.filter((d) => d.searchable).map((d) => d.id),
    excerptChars,
  );
  return docs.map((doc, i) => ({
    label: `D${i + 1}`,
    doc,
    status: indexStatusText(doc),
    opening: doc.searchable ? (openings.get(doc.id) ?? "") : "",
  }));
}

function entryText(e: CollectionEntry, withExcerpt: boolean): string {
  const d = e.doc;
  const facts = [TYPE_NAME[d.fileType] ?? d.fileType, unitCountText(d), sizeText(d.sizeBytes)].filter(Boolean).join(", ");
  const lines = [`[${e.label}] ${d.title}`, `File: ${d.fileName ?? "(pasted notes)"} (${facts})`, `Status: ${e.status}`];
  if (d.courseName) lines.push(`Course: ${d.courseName}`);
  if (d.description) lines.push(`Description: ${d.description.replace(/\s+/g, " ").slice(0, 300)}`);
  if (withExcerpt && e.opening) lines.push(`Opening excerpt: ${e.opening}`);
  return lines.join("\n");
}

/**
 * The DOCUMENT COLLECTION block for the prompt, fitted to `budget` tokens: opening excerpts are
 * dropped first, then documents at the end of the list (with a note saying how many are missing).
 */
export function collectionBlock(
  entries: CollectionEntry[],
  budget: number,
  withExcerpts: boolean,
  selection = false,
): { text: string; listed: CollectionEntry[] } {
  if (!entries.length) return { text: "", listed: [] };
  const n = `${entries.length} document${entries.length === 1 ? "" : "s"}`;
  const header = (shown: number) =>
    `${selection ? `The student selected ${n} for this question` : `The student has uploaded ${n}`}${shown < entries.length ? ` (the first ${shown} are listed)` : ""}:`;
  for (const excerpts of withExcerpts ? [true, false] : [false]) {
    let used = estimateTokens(header(entries.length));
    const listed: CollectionEntry[] = [];
    const parts: string[] = [];
    for (const e of entries) {
      const text = entryText(e, excerpts);
      const t = estimateTokens(text) + 2;
      if (used + t > budget) break;
      used += t;
      listed.push(e);
      parts.push(text);
    }
    // Prefer listing every document without excerpts over a partial list with excerpts.
    if (listed.length === entries.length || !excerpts) {
      if (!listed.length) return { text: "", listed: [] };
      return { text: `${header(listed.length)}\n\n${parts.join("\n\n")}`, listed };
    }
  }
  return { text: "", listed: [] };
}

export function collectionSourceRefs(entries: CollectionEntry[], cited: Set<string>, includeAll: boolean): SourceRef[] {
  return entries
    .filter((e) => includeAll || cited.has(e.label))
    .map((e) => ({
      label: e.label,
      kind: "document" as const,
      chunkId: 0,
      documentId: e.doc.id,
      documentTitle: e.doc.title,
      location: unitCountText(e.doc),
      unitStart: 1,
      excerpt: e.opening || (e.doc.searchable ? "" : "The text of this file couldn't be read reliably."),
      cited: cited.has(e.label),
      fileName: e.doc.fileName,
      status: e.status,
    }));
}

/**
 * Questions about the collection itself ("What are the papers in my document collection?",
 * "Which files did I upload?", "เอกสารมีอะไรบ้าง"). These are answered from the collection
 * overview with opening excerpts rather than from searched passages.
 */
export function isCollectionQuestion(question: string): boolean {
  const q = question.toLowerCase().replace(/\s+/g, " ");
  const things = "(?:papers?|documents?|docs|files?|pdfs?|materials?|readings?|articles?|sources?|uploads?|lectures?|slides? decks?)";
  return (
    /\b(?:document|file|paper|pdf|material|reading)s? (?:collection|library)\b/.test(q) ||
    /\bmy (?:collection|library)\b/.test(q) ||
    new RegExp(`\\b(?:what|which|list|name|show|how many|tell me)\\b[^?.!]{0,40}\\b${things}\\b[^?.!]{0,40}\\b(?:have|uploaded|upload|there|collection|library|available|stored|saved|indexed)\\b`).test(q) ||
    new RegExp(`\\b(?:list|show|name|enumerate|overview of)\\b[^?.!]{0,20}\\b(?:all|my|the|every)\\b[^?.!]{0,12}\\b${things}\\b`).test(q) ||
    new RegExp(`\\bhow many ${things}\\b`).test(q) ||
    /(?:เอกสาร|ไฟล์|บทความ|งานวิจัย|เปเปอร์)[^?]{0,20}(?:อะไรบ้าง|มีอะไร|ทั้งหมด|กี่(?:ไฟล์|ฉบับ|เรื่อง|ชิ้น)|ที่อัปโหลด|ที่อัพโหลด)/.test(question) ||
    /(?:มี|อัปโหลด|อัพโหลด)(?:เอกสาร|ไฟล์|บทความ)/.test(question)
  );
}

/** Questions that need passages from every document ("summarize each paper", "compare the papers"). */
export function isPerDocumentQuestion(question: string): boolean {
  const q = question.toLowerCase();
  return (
    /\b(?:each|every|all (?:of )?(?:the|my)|both|across (?:the|my|all))\b[^?.!]{0,16}\b(?:papers?|documents?|files?|pdfs?|materials?|readings?|articles?|sources?|lectures?)\b/.test(q) ||
    /\bcompare\b[^?.!]{0,30}\b(?:papers|documents|files|pdfs|materials|readings|articles|sources|lectures)\b/.test(q) ||
    /(?:แต่ละ|ทุก)(?:เอกสาร|ไฟล์|บทความ|งานวิจัย)|เปรียบเทียบ(?:เอกสาร|บทความ|งานวิจัย)/.test(question)
  );
}
