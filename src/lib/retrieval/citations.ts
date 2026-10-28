import type { SourceRef } from "@/lib/types";
import type { RetrievedChunk } from "./search";

/** Give each retrieved chunk a short label ([S1], [S2]…) for the prompt. */
export function labelChunks(chunks: RetrievedChunk[]): { label: string; chunk: RetrievedChunk }[] {
  return chunks.map((chunk, i) => ({ label: `S${i + 1}`, chunk }));
}

export function sourcesBlock(labelled: { label: string; chunk: RetrievedChunk }[]): string {
  return labelled
    .map(({ label, chunk }) => `[${label}] ${chunk.documentTitle} (${chunk.location})\n${chunk.text}`)
    .join("\n\n---\n\n");
}

/**
 * Keep only citations that refer to sources we actually supplied. Labels the model invented
 * are removed from the text and reported. Accepts [S1], [S1, S3], [S1][S2], 【S1】.
 */
export function sanitizeCitations(text: string, validLabels: Set<string>): { text: string; cited: Set<string>; removed: string[] } {
  const cited = new Set<string>();
  const removed: string[] = [];
  const out = text.replace(/[[【]\s*((?:S\d+\s*[,;，、]?\s*)+)[\]】]/gi, (_match, inner: string) => {
    const labels = inner
      .split(/[\s,;，、]+/)
      .map((l) => l.trim().toUpperCase())
      .filter(Boolean);
    const keep = labels.filter((l) => validLabels.has(l));
    for (const l of labels) if (!validLabels.has(l)) removed.push(l);
    keep.forEach((l) => cited.add(l));
    return keep.length ? keep.map((l) => `[${l}]`).join("") : "";
  });
  return { text: out.replace(/[ \t]+([.,;:!?])/g, "$1"), cited, removed: [...new Set(removed)] };
}

export function toSourceRefs(labelled: { label: string; chunk: RetrievedChunk }[], cited: Set<string>): SourceRef[] {
  return labelled.map(({ label, chunk }) => ({
    label,
    chunkId: chunk.id,
    documentId: chunk.documentId,
    documentTitle: chunk.documentTitle,
    location: chunk.location,
    unitStart: chunk.unitStart,
    excerpt: chunk.text.length > 420 ? `${chunk.text.slice(0, 420).trimEnd()}…` : chunk.text,
    cited: cited.has(label),
    score: chunk.similarity ?? undefined,
  }));
}
