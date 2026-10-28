import { config } from "@/lib/config";
import { getDb, hasFullText } from "@/lib/db";
import { toFloat32 } from "@/lib/db/sqlite";
import { getProvider, resolveModels } from "@/lib/ai/service";
import { formatLocation } from "@/lib/documents/chunk";

/**
 * Local hybrid retrieval over the student's own documents:
 *   keyword search — SQLite FTS5 with the trigram tokenizer (works for Thai, which has no spaces)
 *   semantic search — cosine similarity over locally stored embedding vectors
 * combined with reciprocal-rank fusion. No external vector database or service.
 */

export interface RetrievedChunk {
  id: number;
  documentId: number;
  documentTitle: string;
  unitKind: string;
  unitStart: number;
  unitEnd: number;
  heading: string | null;
  text: string;
  tokens: number;
  location: string;
  score: number;
  similarity: number | null;
}

export interface Scope {
  documentIds?: number[];
  courseId?: number | null;
}

export interface RetrievalResult {
  chunks: RetrievedChunk[];
  mode: "hybrid" | "keyword" | "vector" | "none";
  scopeDocumentCount: number;
}

const STOPWORDS = new Set(
  "the a an and or of to in on for with is are was were be been it this that these those what which who whom how why when where does do did can could should would about from by as at into than then there their its your you me my we our us please explain tell give show describe".split(
    " ",
  ),
);
const THAI_STOPWORDS = new Set(["อะไร", "อย่างไร", "ไหม", "หรือไม่", "คือ", "และ", "หรือ", "ของ", "ที่", "ใน", "ให้", "ได้", "เป็น", "การ", "ความ", "กับ", "จะ", "ว่า", "ช่วย", "อธิบาย", "บอก", "หน่อย", "ครับ", "ค่ะ", "คะ"]);

const wordSegmenter = new Intl.Segmenter("th", { granularity: "word" });

/** Search terms: words without stopwords; Thai fragments shorter than 3 characters are joined with neighbours. */
export function queryTerms(query: string): string[] {
  const words = [...wordSegmenter.segment(query.toLowerCase())].filter((s) => s.isWordLike).map((s) => s.segment.trim()).filter(Boolean);
  const terms: string[] = [];
  for (let i = 0; i < words.length; i++) {
    let w = words[i];
    const thai = /[฀-๿]/.test(w);
    if (thai) {
      if (THAI_STOPWORDS.has(w)) continue;
      while ([...w].length < 3 && i + 1 < words.length && /[฀-๿]/.test(words[i + 1])) w += words[++i];
    } else if (STOPWORDS.has(w)) {
      continue;
    }
    if ([...w].length >= 3) terms.push(w);
  }
  return [...new Set(terms)].slice(0, 24);
}

/** Build an FTS5 query: quoted terms OR-ed together. */
export function buildFtsQuery(query: string): string | null {
  const unique = queryTerms(query);
  if (!unique.length) return null;
  return unique.map((t) => `"${t.replace(/"/g, '""')}"`).join(" OR ");
}

function countOccurrences(haystack: string, needle: string): number {
  let count = 0;
  let from = 0;
  while (true) {
    const at = haystack.indexOf(needle, from);
    if (at === -1) return count;
    count++;
    from = at + needle.length;
  }
}

/**
 * Keyword search without FTS5: candidates via LIKE, ranked in code with a BM25-style score
 * (rarer terms count more; repeated terms count with diminishing returns).
 */
export function scoreKeywordMatches(query: string, rows: { id: number; text: string }[], limit: number): number[] {
  const terms = queryTerms(query);
  if (!terms.length || !rows.length) return [];
  const lowered = rows.map((r) => ({ id: r.id, text: r.text.toLowerCase(), length: r.text.length }));
  const avgLength = lowered.reduce((s, r) => s + r.length, 0) / lowered.length || 1;
  const df = new Map(terms.map((t) => [t, lowered.filter((r) => r.text.includes(t)).length]));
  const n = lowered.length;
  return lowered
    .map((r) => {
      let score = 0;
      for (const t of terms) {
        const tf = countOccurrences(r.text, t);
        if (!tf) continue;
        const idf = Math.log(1 + (n - df.get(t)! + 0.5) / (df.get(t)! + 0.5));
        score += idf * ((tf * 2.2) / (tf + 1.2 * (0.25 + 0.75 * (r.length / avgLength))));
      }
      return { id: r.id, score };
    })
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((r) => r.id);
}

export function scopeDocumentIds(scope: Scope): number[] {
  const db = getDb();
  if (scope.documentIds?.length) {
    const ids = scope.documentIds.filter((n) => Number.isInteger(n));
    if (!ids.length) return [];
    return db
      .prepare(`SELECT id FROM documents WHERE searchable = 1 AND id IN (${ids.map(() => "?").join(",")})`)
      .all<{ id: number }>(...ids)
      .map((r) => r.id);
  }
  if (scope.courseId) {
    return db.prepare("SELECT id FROM documents WHERE searchable = 1 AND course_id = ?").all<{ id: number }>(scope.courseId).map((r) => r.id);
  }
  return db.prepare("SELECT id FROM documents WHERE searchable = 1").all<{ id: number }>().map((r) => r.id);
}

function keywordSearch(query: string, docIds: number[], limit: number): number[] {
  if (!docIds.length) return [];
  if (!hasFullText()) {
    const terms = queryTerms(query);
    if (!terms.length) return [];
    const rows = getDb()
      .prepare(
        `SELECT id, text FROM chunks WHERE document_id IN (${docIds.map(() => "?").join(",")})
         AND (${terms.map(() => "text LIKE ?").join(" OR ")})`,
      )
      .all<{ id: number; text: string }>(...docIds, ...terms.map((t) => `%${t}%`));
    return scoreKeywordMatches(query, rows, limit);
  }
  const fts = buildFtsQuery(query);
  if (!fts) return [];
  try {
    return getDb()
      .prepare(
        `SELECT c.id FROM chunks_fts JOIN chunks c ON c.id = chunks_fts.rowid
         WHERE chunks_fts MATCH ? AND c.document_id IN (${docIds.map(() => "?").join(",")})
         ORDER BY bm25(chunks_fts) LIMIT ?`,
      )
      .all<{ id: number }>(fts, ...docIds, limit)
      .map((r) => r.id);
  } catch (error) {
    console.warn("[gen-ai] keyword search failed:", error);
    return [];
  }
}

export function cosine(a: Float32Array | number[], b: Float32Array | number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return na && nb ? dot / (Math.sqrt(na) * Math.sqrt(nb)) : 0;
}

async function vectorSearch(
  query: string,
  docIds: number[],
  model: string,
  limit: number,
  signal?: AbortSignal,
): Promise<{ id: number; sim: number }[]> {
  if (!docIds.length) return [];
  const rows = getDb()
    .prepare(`SELECT id, embedding FROM chunks WHERE embed_model = ? AND embedding IS NOT NULL AND document_id IN (${docIds.map(() => "?").join(",")})`)
    .all<{ id: number; embedding: Uint8Array }>(model, ...docIds);
  if (!rows.length) return [];
  const [queryVector] = await getProvider().embed(model, [query], { signal });
  return rows
    .map((r) => ({ id: r.id, sim: cosine(queryVector, toFloat32(r.embedding) ?? []) }))
    .filter((r) => r.sim >= config.minSimilarity)
    .sort((a, b) => b.sim - a.sim)
    .slice(0, limit);
}

export function loadChunks(ids: number[]): Map<number, Omit<RetrievedChunk, "score" | "similarity">> {
  const map = new Map<number, Omit<RetrievedChunk, "score" | "similarity">>();
  if (!ids.length) return map;
  const rows = getDb()
    .prepare(
      `SELECT c.id, c.document_id, c.unit_start, c.unit_end, c.heading, c.text, c.token_estimate, d.title, d.unit_kind
       FROM chunks c JOIN documents d ON d.id = c.document_id WHERE c.id IN (${ids.map(() => "?").join(",")})`,
    )
    .all<{
      id: number;
      document_id: number;
      unit_start: number;
      unit_end: number;
      heading: string | null;
      text: string;
      token_estimate: number;
      title: string;
      unit_kind: string;
    }>(...ids);
  for (const r of rows) {
    map.set(r.id, {
      id: r.id,
      documentId: r.document_id,
      documentTitle: r.title,
      unitKind: r.unit_kind,
      unitStart: r.unit_start,
      unitEnd: r.unit_end,
      heading: r.heading,
      text: r.text,
      tokens: r.token_estimate,
      location: formatLocation(r.unit_kind, r.unit_start, r.unit_end, r.unit_kind === "section" ? r.heading : null),
    });
  }
  return map;
}

export async function retrieve(query: string, scope: Scope, opts: { limit?: number; signal?: AbortSignal } = {}): Promise<RetrievalResult> {
  const limit = opts.limit ?? 6;
  const docIds = scopeDocumentIds(scope);
  if (!docIds.length) return { chunks: [], mode: "none", scopeDocumentCount: 0 };

  const keywordIds = keywordSearch(query, docIds, 30);

  let vectorHits: { id: number; sim: number }[] = [];
  let usedVector = false;
  try {
    const r = await resolveModels();
    if (r.embed) {
      usedVector = true;
      vectorHits = await vectorSearch(query, docIds, r.embed.name, 30, opts.signal);
    }
  } catch (error) {
    // Embedding failed (e.g. model unloaded or service hiccup): fall back to keywords only.
    console.warn("[gen-ai] semantic search unavailable, using keyword search:", error instanceof Error ? error.message : error);
    usedVector = false;
  }

  // Reciprocal-rank fusion.
  const scores = new Map<number, number>();
  const sims = new Map<number, number>();
  keywordIds.forEach((id, rank) => scores.set(id, (scores.get(id) ?? 0) + 1 / (60 + rank)));
  vectorHits.forEach((hit, rank) => {
    scores.set(hit.id, (scores.get(hit.id) ?? 0) + 1 / (60 + rank));
    sims.set(hit.id, hit.sim);
  });
  const ranked = [...scores.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit);
  const details = loadChunks(ranked.map(([id]) => id));
  const chunks = ranked
    .map(([id, score]) => {
      const d = details.get(id);
      return d ? { ...d, score, similarity: sims.get(id) ?? null } : null;
    })
    .filter((c): c is RetrievedChunk => c !== null);

  return { chunks, mode: usedVector ? "hybrid" : "keyword", scopeDocumentCount: docIds.length };
}

/** Evenly spread chunks across the given documents (for quizzes/summaries without a specific topic). */
export function sampleChunks(scope: Scope, maxChunks: number): RetrievedChunk[] {
  const docIds = scopeDocumentIds(scope);
  if (!docIds.length) return [];
  const all = getDb()
    .prepare(`SELECT id FROM chunks WHERE document_id IN (${docIds.map(() => "?").join(",")}) ORDER BY document_id, position`)
    .all<{ id: number }>(...docIds)
    .map((r) => r.id);
  if (!all.length) return [];
  const step = Math.max(1, all.length / maxChunks);
  const picked: number[] = [];
  for (let i = 0; i < all.length && picked.length < maxChunks; i += step) picked.push(all[Math.floor(i)]);
  const details = loadChunks(picked);
  return picked
    .map((id) => details.get(id))
    .filter((c): c is NonNullable<typeof c> => Boolean(c))
    .map((c) => ({ ...c, score: 0, similarity: null }));
}
