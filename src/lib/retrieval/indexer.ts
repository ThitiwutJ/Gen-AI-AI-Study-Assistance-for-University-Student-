import { getDb } from "@/lib/db";
import { fromFloat32 } from "@/lib/db/sqlite";
import { AppError } from "@/lib/errors";
import { getProvider, resolveModels } from "@/lib/ai/service";
import { setIndexState } from "@/lib/documents/repo";

/**
 * Background embedding of document chunks with the local embedding model (POST /api/embed).
 * One document at a time; progress is stored on the document row so the UI can show
 * "Indexing x of y chunks" and it survives page reloads. Keyword search works meanwhile.
 */

const BATCH = 8;

type Queue = { ids: number[]; running: boolean };
const g = globalThis as typeof globalThis & { __genaiIndexQueue?: Queue };
const queue: Queue = (g.__genaiIndexQueue ??= { ids: [], running: false });

export function enqueueIndexing(documentId: number): void {
  if (!queue.ids.includes(documentId)) queue.ids.push(documentId);
  if (!queue.running) void drain();
}

export function isQueued(documentId: number): boolean {
  return queue.ids.includes(documentId);
}

async function drain(): Promise<void> {
  queue.running = true;
  try {
    while (queue.ids.length) {
      const id = queue.ids[0];
      try {
        await indexDocument(id);
      } catch (error) {
        console.error(`[gen-ai] indexing document ${id} failed:`, error);
      } finally {
        queue.ids.shift();
      }
    }
  } finally {
    queue.running = false;
  }
}

export async function indexDocument(documentId: number): Promise<void> {
  const db = getDb();
  const doc = db
    .prepare("SELECT id, title, searchable, chunk_count FROM documents WHERE id = ?")
    .get<{ id: number; title: string; searchable: number; chunk_count: number }>(documentId);
  if (!doc || !doc.searchable || !doc.chunk_count) return;

  let embedModel: { name: string; contextLength: number | null } | null = null;
  try {
    const r = await resolveModels();
    embedModel = r.embed ? { name: r.embed.name, contextLength: r.embed.contextLength } : null;
  } catch (error) {
    setIndexState(documentId, {
      status: "pending",
      error: error instanceof AppError ? error.message : "The AI service isn't reachable; indexing will resume later.",
    });
    return;
  }
  if (!embedModel) {
    setIndexState(documentId, { status: "keyword_only", error: null });
    return;
  }

  const model = embedModel.name;
  const pending = db
    .prepare(
      `SELECT id, heading, text FROM chunks
       WHERE document_id = ? AND (embedding IS NULL OR embed_model IS NULL OR embed_model != ?)
       ORDER BY position`,
    )
    .all<{ id: number; heading: string | null; text: string }>(documentId, model);
  let done = doc.chunk_count - pending.length;
  setIndexState(documentId, { status: "indexing", error: null, indexedChunks: done });

  const update = db.prepare("UPDATE chunks SET embedding = ?, embed_model = ?, embed_dim = ? WHERE id = ?");
  const numCtx = embedModel.contextLength ? Math.min(embedModel.contextLength, 8192) : undefined;
  try {
    for (let i = 0; i < pending.length; i += BATCH) {
      const batch = pending.slice(i, i + BATCH);
      const inputs = batch.map((c) => `${doc.title}${c.heading ? ` — ${c.heading}` : ""}\n${c.text}`);
      const vectors = await getProvider().embed(model, inputs, { numCtx });
      db.transaction(() => {
        batch.forEach((c, j) => update.run(fromFloat32(vectors[j]), model, vectors[j].length, c.id));
      });
      done += batch.length;
      setIndexState(documentId, { status: "indexing", indexedChunks: done });
    }
    setIndexState(documentId, { status: "ready", error: null, embedModel: model, indexedChunks: done });
  } catch (error) {
    const message = error instanceof AppError ? error.message : "Embedding failed.";
    const retryLater = error instanceof AppError && error.code === "ai_not_running";
    setIndexState(documentId, { status: retryLater ? "pending" : "failed", error: `${message} Keyword search still works.` });
  }
}

/**
 * Keep index states consistent with the current embedding model:
 *  - documents embedded with a different model become "stale" (re-index offered in Settings),
 *  - pending / keyword-only documents are indexed automatically once a model exists,
 *  - without an embedding model, pending documents are keyword-only.
 */
export function syncIndexState(embedModel: string | null): void {
  const db = getDb();
  if (!embedModel) {
    db.prepare("UPDATE documents SET index_status = 'keyword_only' WHERE searchable = 1 AND index_status = 'pending'").run();
    return;
  }
  db.prepare(
    "UPDATE documents SET index_status = 'stale' WHERE searchable = 1 AND index_status = 'ready' AND (embed_model IS NULL OR embed_model != ?)",
  ).run(embedModel);
  const toIndex = db
    .prepare("SELECT id FROM documents WHERE searchable = 1 AND chunk_count > 0 AND index_status IN ('pending', 'keyword_only')")
    .all<{ id: number }>();
  for (const row of toIndex) enqueueIndexing(row.id);
}

/** Re-index documents that are stale or failed (or all, if `all`). Returns how many were queued. */
export function reindexDocuments(opts: { all?: boolean; documentId?: number } = {}): number {
  const db = getDb();
  let ids: number[];
  if (opts.documentId) ids = [opts.documentId];
  else if (opts.all) ids = db.prepare("SELECT id FROM documents WHERE searchable = 1 AND chunk_count > 0").all<{ id: number }>().map((r) => r.id);
  else
    ids = db
      .prepare("SELECT id FROM documents WHERE searchable = 1 AND chunk_count > 0 AND index_status IN ('stale', 'failed', 'pending', 'keyword_only')")
      .all<{ id: number }>()
      .map((r) => r.id);
  for (const id of ids) enqueueIndexing(id);
  return ids.length;
}
