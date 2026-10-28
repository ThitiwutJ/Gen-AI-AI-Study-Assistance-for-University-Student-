import { getDb } from "@/lib/db";
import { listCourses } from "./courses";
import { listConversations } from "./conversations";
import { listNotes } from "./notes";
import { listQuizzes, recentAttempts } from "./quizzes";
import { listDocuments } from "@/lib/documents/repo";
import { getSettings } from "@/lib/settings";
import type { DashboardData, LibraryItem } from "@/lib/types";

/** Everything on the dashboard comes from saved data — nothing is estimated or invented. */
export function getDashboard(): DashboardData {
  const db = getDb();
  const count = (table: string) => db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get<{ n: number }>()?.n ?? 0;
  const last = db
    .prepare("SELECT score, max_score FROM quiz_attempts WHERE max_score > 0 ORDER BY id DESC LIMIT 10")
    .all<{ score: number; max_score: number }>();
  const averageScore = last.length ? last.reduce((s, a) => s + a.score / a.max_score, 0) / last.length : null;
  return {
    displayName: getSettings().displayName,
    counts: {
      courses: count("courses"),
      documents: count("documents"),
      notes: count("notes"),
      quizzes: count("quizzes"),
      attempts: count("quiz_attempts"),
      conversations: count("conversations"),
    },
    courses: listCourses(),
    recentDocuments: listDocuments({ limit: 5 }),
    recentNotes: listNotes({ limit: 4 }),
    recentAttempts: recentAttempts(5),
    recentConversations: listConversations(4),
    averageScore,
  };
}

export function searchLibrary(opts: { q?: string; type?: string; courseId?: number }): LibraryItem[] {
  const q = opts.q?.trim() ?? "";
  const type = opts.type ?? "all";
  const items: LibraryItem[] = [];
  if (type === "all" || type === "document") {
    for (const d of listDocuments({ q, courseId: opts.courseId, limit: 200 })) {
      items.push({ type: "document", id: d.id, title: d.title, courseName: d.courseName, updatedAt: d.lastOpenedAt ?? d.updatedAt, snippet: d.description, href: `/materials/${d.id}` });
    }
  }
  if (type === "all" || type === "note") {
    for (const n of listNotes({ q, limit: 200 })) {
      if (opts.courseId && n.courseId !== opts.courseId) continue;
      items.push({ type: "note", id: n.id, title: n.title, courseName: n.courseName, updatedAt: n.updatedAt, snippet: n.preview, href: `/notes/${n.id}` });
    }
  }
  if (type === "all" || type === "quiz") {
    for (const z of listQuizzes({ q, limit: 200 })) {
      if (opts.courseId && z.courseId !== opts.courseId) continue;
      const score = z.lastScore !== null && z.lastMaxScore ? ` · last score ${Math.round((z.lastScore / z.lastMaxScore) * 100)}%` : "";
      items.push({ type: "quiz", id: z.id, title: z.title, courseName: z.courseName, updatedAt: z.createdAt, snippet: `${z.questionCount} questions${score}`, href: `/quizzes/${z.id}` });
    }
  }
  if ((type === "all" || type === "conversation") && !opts.courseId) {
    for (const c of listConversations(200, q)) {
      items.push({ type: "conversation", id: c.id, title: c.title, courseName: null, updatedAt: c.updatedAt, snippet: `${c.messageCount} messages`, href: `/tutor?c=${c.id}` });
    }
  }
  return items.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 300);
}
