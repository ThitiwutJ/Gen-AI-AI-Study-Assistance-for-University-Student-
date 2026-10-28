import fs from "node:fs";
import path from "node:path";
import { getDb, now, uploadsDir } from "@/lib/db";
import type { DocumentDetail, DocumentSummary, FileType, IndexStatus, UnitKind } from "@/lib/types";
import { unitLabel } from "./chunk";

interface DocRow {
  id: number;
  course_id: number | null;
  course_name: string | null;
  title: string;
  description: string | null;
  file_name: string | null;
  file_type: string;
  stored_name: string | null;
  size_bytes: number | null;
  language: string | null;
  unit_kind: string;
  unit_count: number;
  word_count: number;
  chunk_count: number;
  warning: string | null;
  searchable: number;
  index_status: string;
  index_error: string | null;
  embed_model: string | null;
  indexed_chunks: number;
  created_at: string;
  updated_at: string;
  last_opened_at: string | null;
}

const SELECT = `SELECT d.*, c.name AS course_name FROM documents d LEFT JOIN courses c ON c.id = d.course_id`;

export function toDocumentSummary(r: DocRow): DocumentSummary {
  return {
    id: r.id,
    courseId: r.course_id,
    courseName: r.course_name,
    title: r.title,
    description: r.description,
    fileName: r.file_name,
    fileType: r.file_type as FileType,
    sizeBytes: r.size_bytes,
    language: r.language,
    unitKind: r.unit_kind as UnitKind,
    unitCount: r.unit_count,
    wordCount: r.word_count,
    chunkCount: r.chunk_count,
    warning: r.warning,
    searchable: r.searchable === 1,
    indexStatus: r.index_status as IndexStatus,
    indexError: r.index_error,
    embedModel: r.embed_model,
    indexedChunks: r.indexed_chunks,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    lastOpenedAt: r.last_opened_at,
  };
}

export function listDocuments(opts: { courseId?: number | null; q?: string; limit?: number } = {}): DocumentSummary[] {
  const where: string[] = [];
  const params: unknown[] = [];
  if (opts.courseId !== undefined && opts.courseId !== null) {
    where.push("d.course_id = ?");
    params.push(opts.courseId);
  }
  if (opts.q?.trim()) {
    where.push("(d.title LIKE ? OR d.description LIKE ? OR d.file_name LIKE ?)");
    const like = `%${opts.q.trim()}%`;
    params.push(like, like, like);
  }
  const sql = `${SELECT} ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY COALESCE(d.last_opened_at, d.created_at) DESC LIMIT ?`;
  params.push(opts.limit ?? 500);
  return getDb().prepare(sql).all<DocRow>(...params).map(toDocumentSummary);
}

export function getDocument(id: number): DocumentSummary | null {
  const row = getDb().prepare(`${SELECT} WHERE d.id = ?`).get<DocRow>(id);
  return row ? toDocumentSummary(row) : null;
}

export function getDocumentDetail(id: number): DocumentDetail | null {
  const doc = getDocument(id);
  if (!doc) return null;
  const units = getDb()
    .prepare("SELECT unit_index, heading, text FROM document_units WHERE document_id = ? ORDER BY unit_index")
    .all<{ unit_index: number; heading: string | null; text: string }>(id)
    .map((u) => ({ index: u.unit_index, label: unitLabel(doc.unitKind, u.unit_index), heading: u.heading, text: u.text }));
  return { ...doc, units };
}

export function getDocumentsByIds(ids: number[]): DocumentSummary[] {
  if (!ids.length) return [];
  return getDb()
    .prepare(`${SELECT} WHERE d.id IN (${ids.map(() => "?").join(",")})`)
    .all<DocRow>(...ids)
    .map(toDocumentSummary);
}

export function touchDocument(id: number): void {
  getDb().prepare("UPDATE documents SET last_opened_at = ? WHERE id = ?").run(now(), id);
}

export function updateDocument(id: number, patch: { title?: string; description?: string | null; courseId?: number | null }): DocumentSummary | null {
  const sets: string[] = [];
  const params: unknown[] = [];
  if (patch.title !== undefined) {
    sets.push("title = ?");
    params.push(patch.title);
  }
  if (patch.description !== undefined) {
    sets.push("description = ?");
    params.push(patch.description);
  }
  if (patch.courseId !== undefined) {
    sets.push("course_id = ?");
    params.push(patch.courseId);
  }
  if (sets.length) {
    sets.push("updated_at = ?");
    params.push(now(), id);
    getDb().prepare(`UPDATE documents SET ${sets.join(", ")} WHERE id = ?`).run(...params);
  }
  return getDocument(id);
}

export function setIndexState(
  id: number,
  state: { status: IndexStatus; error?: string | null; embedModel?: string | null; indexedChunks?: number },
): void {
  const db = getDb();
  db.prepare(
    `UPDATE documents SET index_status = ?, index_error = ?,
       embed_model = COALESCE(?, embed_model), indexed_chunks = COALESCE(?, indexed_chunks)
     WHERE id = ?`,
  ).run(state.status, state.error ?? null, state.embedModel ?? null, state.indexedChunks ?? null, id);
}

/** Deletes the document, its stored file, its chunks/vectors and keyword index entries. */
export function deleteDocument(id: number): boolean {
  const db = getDb();
  const doc = db.prepare("SELECT stored_name FROM documents WHERE id = ?").get<{ stored_name: string | null }>(id);
  if (!doc) return false;
  db.transaction(() => {
    db.prepare("DELETE FROM chunks WHERE document_id = ?").run(id); // fires FTS delete trigger
    db.prepare("DELETE FROM document_units WHERE document_id = ?").run(id);
    db.prepare("DELETE FROM documents WHERE id = ?").run(id);
  });
  if (doc.stored_name) {
    const file = path.join(uploadsDir(), path.basename(doc.stored_name));
    fs.rmSync(file, { force: true });
  }
  return true;
}
