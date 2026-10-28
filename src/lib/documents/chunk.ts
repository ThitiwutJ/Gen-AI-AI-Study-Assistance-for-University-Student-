import { estimateTokens } from "@/lib/ai/budget";
import type { ExtractedUnit } from "./extract";

/**
 * Split extracted units into retrieval chunks.
 * - Size is measured in (estimated) tokens so English and Thai behave the same.
 * - Boundaries come from Intl.Segmenter (Thai has no spaces between words).
 * - Every chunk keeps the page / slide / section range it came from.
 * - Very small consecutive units (e.g. short slides) are merged, keeping the range.
 */

export interface Chunk {
  position: number;
  unitStart: number;
  unitEnd: number;
  heading: string | null;
  text: string;
  tokens: number;
}

export interface ChunkOptions {
  targetTokens?: number;
  maxTokens?: number;
  overlapTokens?: number;
  minUnitTokens?: number;
}

const sentenceSegmenter = new Intl.Segmenter("th", { granularity: "sentence" });
const wordSegmenter = new Intl.Segmenter("th", { granularity: "word" });

function sentences(text: string): string[] {
  const out: string[] = [];
  for (const paragraph of text.split(/\n+/)) {
    for (const s of sentenceSegmenter.segment(paragraph)) {
      const t = s.segment.trim();
      if (t) out.push(t);
    }
    if (out.length) out[out.length - 1] += "\n";
  }
  return out;
}

/** Break a too-long sentence at word boundaries. */
function splitLong(sentence: string, maxTokens: number): string[] {
  const pieces: string[] = [];
  let current = "";
  for (const w of wordSegmenter.segment(sentence)) {
    if (current && estimateTokens(current + w.segment) > maxTokens) {
      pieces.push(current.trim());
      current = "";
    }
    current += w.segment;
  }
  if (current.trim()) pieces.push(current.trim());
  return pieces;
}

function joinSentences(parts: string[]): string {
  return parts
    .join(" ")
    .replace(/ *\n */g, "\n")
    .replace(/[ ]{2,}/g, " ")
    .trim();
}

export function chunkUnits(units: ExtractedUnit[], options: ChunkOptions = {}): Chunk[] {
  const target = options.targetTokens ?? 450;
  const max = options.maxTokens ?? 600;
  const overlap = options.overlapTokens ?? 60;
  const minUnit = options.minUnitTokens ?? 120;

  // 1) Merge runs of small units so short slides don't become tiny, useless chunks.
  const groups: { start: number; end: number; heading: string | null; text: string }[] = [];
  for (const unit of units) {
    const last = groups[groups.length - 1];
    const tokens = estimateTokens(unit.text);
    if (last && estimateTokens(last.text) < minUnit && estimateTokens(last.text) + tokens <= target) {
      last.end = unit.index;
      last.text = `${last.text}\n\n${unit.text}`;
    } else {
      groups.push({ start: unit.index, end: unit.index, heading: unit.heading, text: unit.text });
    }
  }

  // 2) Split each group into overlapping chunks at sentence boundaries.
  const chunks: Chunk[] = [];
  for (const group of groups) {
    const parts = sentences(group.text).flatMap((s) => (estimateTokens(s) > max ? splitLong(s, max) : [s]));
    let current: string[] = [];
    let currentTokens = 0;
    const flush = () => {
      const text = joinSentences(current);
      if (text) {
        chunks.push({
          position: chunks.length,
          unitStart: group.start,
          unitEnd: group.end,
          heading: group.heading,
          text,
          tokens: estimateTokens(text),
        });
      }
    };
    for (const part of parts) {
      const t = estimateTokens(part);
      if (current.length && currentTokens + t > target) {
        flush();
        // Carry the last sentences (up to `overlap` tokens) into the next chunk.
        const carry: string[] = [];
        let carried = 0;
        for (let i = current.length - 1; i >= 0; i--) {
          const ct = estimateTokens(current[i]);
          if (carried + ct > overlap) break;
          carry.unshift(current[i]);
          carried += ct;
        }
        current = carry;
        currentTokens = carried;
      }
      current.push(part);
      currentTokens += t;
    }
    flush();
  }
  return chunks;
}

export function formatLocation(kind: string, start: number, end: number, heading: string | null): string {
  if (kind === "page") return start === end ? `p. ${start}` : `pp. ${start}–${end}`;
  if (kind === "slide") return start === end ? `slide ${start}` : `slides ${start}–${end}`;
  const label = start === end ? `section ${start}` : `sections ${start}–${end}`;
  return heading ? `${label}: ${heading.length > 60 ? `${heading.slice(0, 57)}…` : heading}` : label;
}

export function unitLabel(kind: string, index: number): string {
  if (kind === "page") return `Page ${index}`;
  if (kind === "slide") return `Slide ${index}`;
  return `Section ${index}`;
}
