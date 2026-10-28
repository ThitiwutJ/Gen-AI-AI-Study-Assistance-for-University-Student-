import { getDb, now } from "@/lib/db";
import { AppError } from "@/lib/errors";
import type { Course } from "@/lib/types";

interface Row {
  id: number;
  name: string;
  code: string | null;
  created_at: string;
  document_count: number;
}

function toCourse(r: Row): Course {
  return { id: r.id, name: r.name, code: r.code, createdAt: r.created_at, documentCount: r.document_count };
}

export function listCourses(): Course[] {
  return getDb()
    .prepare(
      `SELECT c.*, (SELECT COUNT(*) FROM documents d WHERE d.course_id = c.id) AS document_count
       FROM courses c ORDER BY c.name COLLATE NOCASE`,
    )
    .all<Row>()
    .map(toCourse);
}

export function getCourse(id: number): Course | null {
  const row = getDb()
    .prepare(`SELECT c.*, (SELECT COUNT(*) FROM documents d WHERE d.course_id = c.id) AS document_count FROM courses c WHERE c.id = ?`)
    .get<Row>(id);
  return row ? toCourse(row) : null;
}

export function createCourse(name: string, code?: string | null): Course {
  const clean = name.trim();
  if (!clean) throw new AppError("invalid_input", "Give the course a name.", 400);
  const exists = getDb().prepare("SELECT id FROM courses WHERE name = ? COLLATE NOCASE").get<{ id: number }>(clean);
  if (exists) throw new AppError("duplicate", `A course called “${clean}” already exists.`, 409);
  const res = getDb()
    .prepare("INSERT INTO courses (name, code, created_at) VALUES (?, ?, ?)")
    .run(clean.slice(0, 120), code?.trim() || null, now());
  return getCourse(res.lastInsertRowid)!;
}

export function updateCourse(id: number, patch: { name?: string; code?: string | null }): Course | null {
  if (patch.name !== undefined) {
    const clean = patch.name.trim();
    if (!clean) throw new AppError("invalid_input", "Course name can't be empty.", 400);
    getDb().prepare("UPDATE courses SET name = ? WHERE id = ?").run(clean.slice(0, 120), id);
  }
  if (patch.code !== undefined) getDb().prepare("UPDATE courses SET code = ? WHERE id = ?").run(patch.code?.trim() || null, id);
  return getCourse(id);
}

/** Deleting a course keeps its materials; they become "No course". */
export function deleteCourse(id: number): boolean {
  return getDb().prepare("DELETE FROM courses WHERE id = ?").run(id).changes > 0;
}
