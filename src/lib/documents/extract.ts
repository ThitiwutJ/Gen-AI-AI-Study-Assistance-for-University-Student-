import JSZip from "jszip";
import { AppError } from "@/lib/errors";
import type { FileType, UnitKind } from "@/lib/types";
import { cleanText, decodeXmlEntities, wordCount } from "./text-utils";

/**
 * Text extraction that keeps location metadata:
 *   PDF → one unit per page, PPTX → one unit per slide (with speaker notes),
 *   DOCX / text → one unit per heading section (or ~400-word parts when there are no headings).
 * Everything runs locally; nothing is sent anywhere.
 */

export interface ExtractedUnit {
  index: number; // 1-based page / slide / section number
  heading: string | null;
  text: string;
}

export interface Extraction {
  fileType: FileType;
  unitKind: UnitKind;
  units: ExtractedUnit[];
  warnings: string[];
  /** The document's own title (PDF metadata, first slide title or first heading), if any. */
  title?: string | null;
}

function cleanTitle(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const t = value.replace(/^Microsoft (Word|PowerPoint) - /i, "").replace(/\.(docx?|pptx?|pdf)$/i, "").replace(/\s+/g, " ").trim();
  return t.length >= 3 && t.length <= 150 && !/^untitled/i.test(t) ? t : null;
}

export const SUPPORTED_EXTENSIONS = ["pdf", "docx", "pptx", "txt", "md"] as const;

export function fileTypeFromName(name: string): FileType | null {
  const ext = name.toLowerCase().split(".").pop() ?? "";
  if (ext === "markdown") return "md";
  return (SUPPORTED_EXTENSIONS as readonly string[]).includes(ext) ? (ext as FileType) : null;
}

function invalidFile(message: string): AppError {
  return new AppError("invalid_file", message, 422);
}

export async function extractDocument(buffer: Buffer, fileType: FileType): Promise<Extraction> {
  switch (fileType) {
    case "pdf":
      if (buffer.subarray(0, 1024).indexOf("%PDF") === -1) throw invalidFile("This file isn't a valid PDF.");
      return extractPdf(buffer);
    case "docx":
      if (buffer[0] !== 0x50 || buffer[1] !== 0x4b) throw invalidFile("This file isn't a valid Word (.docx) document.");
      return extractDocx(buffer);
    case "pptx":
      if (buffer[0] !== 0x50 || buffer[1] !== 0x4b) throw invalidFile("This file isn't a valid PowerPoint (.pptx) file.");
      return extractPptx(buffer);
    case "txt":
    case "md":
    case "paste":
      return extractPlainText(decodeText(buffer), fileType);
  }
}

// ---------- PDF ----------

async function extractPdf(buffer: Buffer): Promise<Extraction> {
  const { extractText, getDocumentProxy, getMeta } = await import("unpdf");
  let pages: string[];
  let title: string | null = null;
  try {
    const pdf = await getDocumentProxy(new Uint8Array(buffer));
    const result = await extractText(pdf, { mergePages: false });
    pages = Array.isArray(result.text) ? result.text : [String(result.text)];
    try {
      const meta = await getMeta(pdf);
      title = cleanTitle((meta.info as Record<string, unknown> | undefined)?.Title);
    } catch {
      /* metadata is optional */
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/password/i.test(message)) throw invalidFile("This PDF is password-protected. Remove the password and upload it again.");
    throw invalidFile("This PDF couldn't be read. It may be damaged or use an unsupported format.");
  }
  const units = pages.map((text, i) => ({ index: i + 1, heading: null, text: cleanText(text) }));
  const warnings: string[] = [];
  const empty = units.filter((u) => u.text.length < 15).length;
  if (units.length && empty === units.length) {
    throw invalidFile(
      "No readable text was found in this PDF. It is probably scanned (pages are images), and Gen AI can't read text from images (no OCR).",
    );
  }
  if (empty > 0) {
    warnings.push(
      `${empty} of ${units.length} pages had no readable text — they may be scanned images or diagrams, which Gen AI can't read.`,
    );
  }
  return { fileType: "pdf", unitKind: "page", units: units.filter((u) => u.text.length > 0), warnings, title };
}

// ---------- DOCX ----------

function htmlToText(html: string): string {
  return decodeXmlEntities(
    html
      .replace(/<(br|\/p|\/li|\/tr|\/h[1-6])\s*\/?>/gi, "\n")
      .replace(/<\/t[dh]>/gi, " | ")
      .replace(/<li[^>]*>/gi, "• ")
      .replace(/<[^>]+>/g, ""),
  );
}

async function extractDocx(buffer: Buffer): Promise<Extraction> {
  const mammoth = await import("mammoth");
  let html: string;
  try {
    const result = await mammoth.convertToHtml({ buffer });
    html = result.value;
  } catch {
    throw invalidFile("This Word document couldn't be read. It may be damaged, or it may be an old .doc file (save it as .docx).");
  }
  // Split on headings to keep section titles as location metadata.
  const parts = html.split(/(?=<h[1-3][^>]*>)/i);
  const sections: { heading: string | null; text: string }[] = [];
  for (const part of parts) {
    const headingMatch = part.match(/^<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>/i);
    const heading = headingMatch ? cleanText(htmlToText(headingMatch[1])) : null;
    const body = cleanText(htmlToText(headingMatch ? part.slice(headingMatch[0].length) : part));
    if (!heading && !body) continue;
    sections.push({ heading, text: heading ? `${heading}\n${body}`.trim() : body });
  }
  const units = sections.length > 1 ? sections : splitIntoParts(sections.map((s) => s.text).join("\n\n"));
  return { fileType: "docx", unitKind: "section", units: number(units), warnings: [], title: cleanTitle(sections.find((s) => s.heading)?.heading) };
}

// ---------- PPTX ----------

function paragraphsFromXml(xml: string): string[] {
  const paragraphs: string[] = [];
  for (const p of xml.split(/<\/a:p>/)) {
    const runs = [...p.matchAll(/<a:t>([\s\S]*?)<\/a:t>|<a:t [^>]*>([\s\S]*?)<\/a:t>/g)].map((m) => decodeXmlEntities(m[1] ?? m[2] ?? ""));
    const line = runs.join("").trim();
    if (line) paragraphs.push(line);
  }
  return paragraphs;
}

async function extractPptx(buffer: Buffer): Promise<Extraction> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(buffer);
  } catch {
    throw invalidFile("This PowerPoint file couldn't be opened. It may be damaged.");
  }
  const presentation = await zip.file("ppt/presentation.xml")?.async("string");
  const presRels = await zip.file("ppt/_rels/presentation.xml.rels")?.async("string");
  if (!presentation || !presRels) throw invalidFile("This doesn't look like a PowerPoint (.pptx) presentation.");

  const relTargets = new Map<string, string>();
  for (const m of presRels.matchAll(/<Relationship\b([^>]*)\/?>/g)) {
    const id = m[1].match(/Id="([^"]+)"/)?.[1];
    const target = m[1].match(/Target="([^"]+)"/)?.[1];
    if (id && target) relTargets.set(id, target.replace(/^\/?ppt\//, "").replace(/^\//, ""));
  }
  const slidePaths = [...presentation.matchAll(/<p:sldId\b[^>]*r:id="([^"]+)"/g)]
    .map((m) => relTargets.get(m[1]))
    .filter((t): t is string => Boolean(t))
    .map((t) => `ppt/${t}`);

  const units: ExtractedUnit[] = [];
  for (let i = 0; i < slidePaths.length; i++) {
    const slideXml = await zip.file(slidePaths[i])?.async("string");
    if (!slideXml) continue;
    const paragraphs = paragraphsFromXml(slideXml);
    // Speaker notes often contain the actual explanation.
    const relsPath = slidePaths[i].replace(/slides\/(slide\d+\.xml)$/, "slides/_rels/$1.rels");
    const rels = await zip.file(relsPath)?.async("string");
    const notesTarget = rels?.match(/Type="[^"]*notesSlide"[^>]*Target="([^"]+)"/)?.[1] ?? rels?.match(/Target="([^"]+notesSlide[^"]*)"/)?.[1];
    let notes: string[] = [];
    if (notesTarget) {
      const notesPath = `ppt/${notesTarget.replace(/^\.\.\//, "")}`;
      const notesXml = await zip.file(notesPath)?.async("string");
      if (notesXml) notes = paragraphsFromXml(notesXml).filter((p) => !/^\d+$/.test(p));
    }
    const heading = paragraphs[0] ?? null;
    const text = [paragraphs.join("\n"), notes.length ? `Speaker notes: ${notes.join("\n")}` : ""].filter(Boolean).join("\n\n");
    units.push({ index: i + 1, heading, text: cleanText(text) });
  }
  const warnings: string[] = [];
  const empty = units.filter((u) => u.text.length < 3).length;
  if (units.length && empty === units.length) {
    throw invalidFile("No text was found on these slides. They may contain only images, which Gen AI can't read.");
  }
  if (empty) warnings.push(`${empty} of ${units.length} slides had no text (images only).`);
  return { fileType: "pptx", unitKind: "slide", units: units.filter((u) => u.text.length >= 3), warnings, title: cleanTitle(units[0]?.heading) };
}

// ---------- Plain text / Markdown / pasted notes ----------

/** UTF-8 first; fall back to Windows-874 (legacy Thai) when UTF-8 decoding produces junk. */
export function decodeText(buffer: Buffer): string {
  if (buffer.subarray(0, 4096).includes(0)) throw invalidFile("This file looks like a binary file, not plain text.");
  const utf8 = new TextDecoder("utf-8").decode(buffer).replace(/^﻿/, "");
  const bad = (utf8.match(/�/g) ?? []).length;
  if (bad > 5) {
    try {
      const thai = new TextDecoder("windows-874").decode(buffer);
      if (/[฀-๿]/.test(thai) && !(thai.match(/�/g) ?? []).length) return thai;
    } catch {
      /* encoding not available */
    }
  }
  return utf8;
}

export function extractPlainText(raw: string, fileType: FileType): Extraction {
  const text = cleanText(raw);
  const lines = text.split("\n");
  const sections: { heading: string | null; text: string }[] = [];
  let current: { heading: string | null; lines: string[] } = { heading: null, lines: [] };
  for (const line of lines) {
    const h = line.match(/^#{1,3}\s+(.+)$/);
    if (h) {
      if (current.lines.join("").trim() || current.heading) sections.push({ heading: current.heading, text: current.lines.join("\n").trim() });
      current = { heading: h[1].trim(), lines: [h[1].trim()] };
    } else {
      current.lines.push(line);
    }
  }
  if (current.lines.join("").trim()) sections.push({ heading: current.heading, text: current.lines.join("\n").trim() });
  const usable = sections.filter((s) => s.text);
  const units = usable.length > 1 ? usable : splitIntoParts(text);
  return { fileType, unitKind: "section", units: number(units), warnings: [], title: cleanTitle(usable.find((s) => s.heading)?.heading) };
}

/** Split long heading-less text into ~400-word parts at paragraph boundaries. */
function splitIntoParts(text: string, target = 400): { heading: string | null; text: string }[] {
  const paragraphs = text.split(/\n{2,}|\n/).map((p) => p.trim()).filter(Boolean);
  const parts: { heading: string | null; text: string }[] = [];
  let buf: string[] = [];
  let words = 0;
  for (const p of paragraphs) {
    const w = wordCount(p);
    if (words > 0 && words + w > target) {
      parts.push({ heading: null, text: buf.join("\n") });
      buf = [];
      words = 0;
    }
    buf.push(p);
    words += w;
  }
  if (buf.length) parts.push({ heading: null, text: buf.join("\n") });
  return parts;
}

function number(units: { heading: string | null; text: string }[]): ExtractedUnit[] {
  return units.filter((u) => u.text.trim()).map((u, i) => ({ index: i + 1, heading: u.heading, text: u.text }));
}
