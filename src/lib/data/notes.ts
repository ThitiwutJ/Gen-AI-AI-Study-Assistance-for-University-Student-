import { getDb, now, parseJson } from "@/lib/db";
import type { NoteDetail, NoteKind, NoteSummary } from "@/lib/types";

interface Row {
  id: number;
  title: string;
  kind: string;
  content: string;
  document_id: number | null;
  document_title: string | null;
  course_id: number | null;
  course_name: string | null;
  model: string | null;
  language: string | null;
  meta: string | null;
  created_at: string;
  updated_at: string;
}

const SELECT = `SELECT n.*, d.title AS document_title, c.name AS course_name
  FROM notes n LEFT JOIN documents d ON d.id = n.document_id LEFT JOIN courses c ON c.id = n.course_id`;

function preview(content: string): string {
  const plain = content
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/[#>*_`|$\\-]+/g, " ")
    .replace(/\[(S\d+)\]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return plain.length > 180 ? `${plain.slice(0, 177)}…` : plain;
}

function toSummary(r: Row): NoteSummary {
  return {
    id: r.id,
    title: r.title,
    kind: r.kind as NoteKind,
    documentId: r.document_id,
    documentTitle: r.document_title,
    courseId: r.course_id,
    courseName: r.course_name,
    model: r.model,
    language: r.language,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    preview: preview(r.content),
  };
}

export function listNotes(opts: { q?: string; documentId?: number; limit?: number } = {}): NoteSummary[] {
  const where: string[] = [];
  const params: unknown[] = [];
  if (opts.q?.trim()) {
    where.push("(n.title LIKE ? OR n.content LIKE ?)");
    params.push(`%${opts.q.trim()}%`, `%${opts.q.trim()}%`);
  }
  if (opts.documentId) {
    where.push("n.document_id = ?");
    params.push(opts.documentId);
  }
  params.push(opts.limit ?? 500);
  return getDb()
    .prepare(`${SELECT} ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY n.updated_at DESC LIMIT ?`)
    .all<Row>(...params)
    .map(toSummary);
}

export function getNote(id: number): NoteDetail | null {
  const row = getDb().prepare(`${SELECT} WHERE n.id = ?`).get<Row>(id);
  if (!row) return null;
  return { ...toSummary(row), content: row.content, meta: parseJson<NoteDetail["meta"]>(row.meta, null) };
}

export function createNote(input: {
  title: string;
  kind: NoteKind;
  content: string;
  documentId: number | null;
  courseId: number | null;
  model: string | null;
  language: string | null;
  meta?: NoteDetail["meta"];
}): NoteDetail {
  const ts = now();
  const res = getDb()
    .prepare(
      "INSERT INTO notes (title, kind, content, document_id, course_id, model, language, meta, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .run(input.title.slice(0, 200), input.kind, input.content, input.documentId, input.courseId, input.model, input.language, input.meta ? JSON.stringify(input.meta) : null, ts, ts);
  return getNote(res.lastInsertRowid)!;
}

export function updateNote(id: number, patch: { title?: string; content?: string }): NoteDetail | null {
  if (patch.title !== undefined) getDb().prepare("UPDATE notes SET title = ?, updated_at = ? WHERE id = ?").run(patch.title.trim().slice(0, 200) || "Untitled note", now(), id);
  if (patch.content !== undefined) getDb().prepare("UPDATE notes SET content = ?, updated_at = ? WHERE id = ?").run(patch.content, now(), id);
  return getNote(id);
}

export function deleteNote(id: number): boolean {
  return getDb().prepare("DELETE FROM notes WHERE id = ?").run(id).changes > 0;
}
