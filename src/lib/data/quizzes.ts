import { getDb, now, parseJson } from "@/lib/db";
import type { AttemptDetail, AttemptSummary, Difficulty, QuestionResult, QuizDetail, QuizQuestion, QuizSummary, SourceRef } from "@/lib/types";

interface QuizRow {
  id: number;
  title: string;
  course_id: number | null;
  course_name: string | null;
  document_ids: string;
  topic: string | null;
  difficulty: string;
  questions: string;
  sources: string;
  model: string | null;
  language: string | null;
  meta: string | null;
  created_at: string;
  attempt_count: number;
  last_score: number | null;
  last_max: number | null;
}

interface AttemptRow {
  id: number;
  quiz_id: number;
  answers: string;
  results: string;
  score: number;
  max_score: number;
  ungraded: number;
  model: string | null;
  created_at: string;
}

const SELECT = `SELECT q.*, c.name AS course_name,
  (SELECT COUNT(*) FROM quiz_attempts a WHERE a.quiz_id = q.id) AS attempt_count,
  (SELECT a.score FROM quiz_attempts a WHERE a.quiz_id = q.id ORDER BY a.id DESC LIMIT 1) AS last_score,
  (SELECT a.max_score FROM quiz_attempts a WHERE a.quiz_id = q.id ORDER BY a.id DESC LIMIT 1) AS last_max
  FROM quizzes q LEFT JOIN courses c ON c.id = q.course_id`;

function toSummary(r: QuizRow): QuizSummary {
  return {
    id: r.id,
    title: r.title,
    courseId: r.course_id,
    courseName: r.course_name,
    documentIds: parseJson<number[]>(r.document_ids, []),
    topic: r.topic,
    difficulty: r.difficulty as Difficulty,
    language: r.language,
    questionCount: parseJson<QuizQuestion[]>(r.questions, []).length,
    model: r.model,
    createdAt: r.created_at,
    attemptCount: r.attempt_count,
    lastScore: r.last_score,
    lastMaxScore: r.last_max,
  };
}

function toAttemptSummary(r: AttemptRow): AttemptSummary {
  return { id: r.id, quizId: r.quiz_id, score: r.score, maxScore: r.max_score, ungraded: r.ungraded, createdAt: r.created_at };
}

export function listQuizzes(opts: { q?: string; limit?: number } = {}): QuizSummary[] {
  const params: unknown[] = [];
  let where = "";
  if (opts.q?.trim()) {
    where = "WHERE q.title LIKE ? OR q.topic LIKE ?";
    params.push(`%${opts.q.trim()}%`, `%${opts.q.trim()}%`);
  }
  params.push(opts.limit ?? 500);
  return getDb().prepare(`${SELECT} ${where} ORDER BY q.created_at DESC LIMIT ?`).all<QuizRow>(...params).map(toSummary);
}

export function getQuiz(id: number): QuizDetail | null {
  const row = getDb().prepare(`${SELECT} WHERE q.id = ?`).get<QuizRow>(id);
  if (!row) return null;
  const attempts = getDb().prepare("SELECT * FROM quiz_attempts WHERE quiz_id = ? ORDER BY id DESC").all<AttemptRow>(id).map(toAttemptSummary);
  const marked = getDb()
    .prepare("SELECT question_id FROM flashcard_marks WHERE quiz_id = ? AND marked = 1")
    .all<{ question_id: string }>(id)
    .map((r) => r.question_id);
  return {
    ...toSummary(row),
    questions: parseJson<QuizQuestion[]>(row.questions, []),
    sources: parseJson<SourceRef[]>(row.sources, []),
    meta: parseJson<QuizDetail["meta"]>(row.meta, null),
    attempts,
    marked,
  };
}

export function createQuiz(input: {
  title: string;
  courseId: number | null;
  documentIds: number[];
  topic: string | null;
  difficulty: Difficulty;
  questions: QuizQuestion[];
  sources: SourceRef[];
  model: string | null;
  language: string | null;
  meta: QuizDetail["meta"];
}): QuizDetail {
  const res = getDb()
    .prepare(
      `INSERT INTO quizzes (title, course_id, document_ids, topic, difficulty, questions, sources, model, language, meta, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.title.slice(0, 200),
      input.courseId,
      JSON.stringify(input.documentIds),
      input.topic,
      input.difficulty,
      JSON.stringify(input.questions),
      JSON.stringify(input.sources),
      input.model,
      input.language,
      JSON.stringify(input.meta),
      now(),
    );
  return getQuiz(res.lastInsertRowid)!;
}

export function renameQuiz(id: number, title: string): void {
  getDb().prepare("UPDATE quizzes SET title = ? WHERE id = ?").run(title.trim().slice(0, 200) || "Untitled quiz", id);
}

export function deleteQuiz(id: number): boolean {
  return getDb().prepare("DELETE FROM quizzes WHERE id = ?").run(id).changes > 0;
}

export function setFlashcardMark(quizId: number, questionId: string, marked: boolean): void {
  getDb()
    .prepare("INSERT INTO flashcard_marks (quiz_id, question_id, marked) VALUES (?, ?, ?) ON CONFLICT(quiz_id, question_id) DO UPDATE SET marked = excluded.marked")
    .run(quizId, questionId, marked ? 1 : 0);
}

export function createAttempt(input: {
  quizId: number;
  answers: Record<string, string>;
  results: QuestionResult[];
  score: number;
  maxScore: number;
  ungraded: number;
  model: string | null;
}): AttemptDetail {
  const res = getDb()
    .prepare("INSERT INTO quiz_attempts (quiz_id, answers, results, score, max_score, ungraded, model, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
    .run(input.quizId, JSON.stringify(input.answers), JSON.stringify(input.results), input.score, input.maxScore, input.ungraded, input.model, now());
  return getAttempt(res.lastInsertRowid)!;
}

export function getAttempt(id: number): AttemptDetail | null {
  const row = getDb().prepare("SELECT * FROM quiz_attempts WHERE id = ?").get<AttemptRow>(id);
  if (!row) return null;
  const quiz = getQuiz(row.quiz_id);
  if (!quiz) return null;
  return {
    ...toAttemptSummary(row),
    quizTitle: quiz.title,
    questions: quiz.questions,
    sources: quiz.sources,
    results: parseJson<QuestionResult[]>(row.results, []),
    model: row.model,
  };
}

export function recentAttempts(limit = 5): (AttemptSummary & { quizTitle: string })[] {
  return getDb()
    .prepare("SELECT a.*, q.title AS quiz_title FROM quiz_attempts a JOIN quizzes q ON q.id = a.quiz_id ORDER BY a.id DESC LIMIT ?")
    .all<AttemptRow & { quiz_title: string }>(limit)
    .map((r) => ({ ...toAttemptSummary(r), quizTitle: r.quiz_title }));
}
