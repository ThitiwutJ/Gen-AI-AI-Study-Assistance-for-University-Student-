import { getDb, now, parseJson } from "@/lib/db";
import type { ContextScope, ConversationDetail, ConversationSummary, LanguagePref, Level, MessageView, SourceRef } from "@/lib/types";

interface ConvRow {
  id: number;
  title: string;
  course_id: number | null;
  document_ids: string;
  scope: string;
  level: string;
  language: string;
  created_at: string;
  updated_at: string;
  message_count: number;
}

interface MsgRow {
  id: number;
  role: string;
  content: string;
  sources: string | null;
  model: string | null;
  meta: string | null;
  created_at: string;
}

function toSummary(r: ConvRow): ConversationSummary {
  return {
    id: r.id,
    title: r.title,
    scope: r.scope as ContextScope,
    courseId: r.course_id,
    documentIds: parseJson<number[]>(r.document_ids, []),
    level: r.level as Level,
    language: r.language as LanguagePref,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    messageCount: r.message_count,
  };
}

export function toMessage(r: MsgRow): MessageView {
  return {
    id: r.id,
    role: r.role as MessageView["role"],
    content: r.content,
    sources: parseJson<SourceRef[]>(r.sources, []),
    model: r.model,
    meta: parseJson<MessageView["meta"]>(r.meta, null),
    createdAt: r.created_at,
  };
}

const SELECT = `SELECT c.*, (SELECT COUNT(*) FROM messages m WHERE m.conversation_id = c.id) AS message_count FROM conversations c`;

export function listConversations(limit = 100, q?: string): ConversationSummary[] {
  if (q?.trim()) {
    return getDb()
      .prepare(
        `${SELECT} WHERE c.title LIKE ? OR EXISTS (SELECT 1 FROM messages m WHERE m.conversation_id = c.id AND m.content LIKE ?)
         ORDER BY c.updated_at DESC LIMIT ?`,
      )
      .all<ConvRow>(`%${q.trim()}%`, `%${q.trim()}%`, limit)
      .map(toSummary);
  }
  return getDb().prepare(`${SELECT} ORDER BY c.updated_at DESC LIMIT ?`).all<ConvRow>(limit).map(toSummary);
}

export function getConversation(id: number): ConversationDetail | null {
  const row = getDb().prepare(`${SELECT} WHERE c.id = ?`).get<ConvRow>(id);
  if (!row) return null;
  const messages = getDb()
    .prepare("SELECT * FROM messages WHERE conversation_id = ? ORDER BY id")
    .all<MsgRow>(id)
    .map(toMessage);
  return { ...toSummary(row), messages };
}

export function createConversation(input: {
  title?: string;
  scope?: ContextScope;
  courseId?: number | null;
  documentIds?: number[];
  level?: Level;
  language?: LanguagePref;
}): ConversationSummary {
  const ts = now();
  const res = getDb()
    .prepare("INSERT INTO conversations (title, scope, course_id, document_ids, level, language, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
    .run(
      input.title?.trim() || "New conversation",
      input.scope ?? "all",
      input.courseId ?? null,
      JSON.stringify(input.documentIds ?? []),
      input.level ?? "standard",
      input.language ?? "auto",
      ts,
      ts,
    );
  return toSummary(getDb().prepare(`${SELECT} WHERE c.id = ?`).get<ConvRow>(res.lastInsertRowid)!);
}

export function updateConversation(
  id: number,
  patch: { title?: string; scope?: ContextScope; courseId?: number | null; documentIds?: number[]; level?: Level; language?: LanguagePref },
): void {
  const sets: string[] = [];
  const params: unknown[] = [];
  if (patch.scope !== undefined) {
    sets.push("scope = ?");
    params.push(patch.scope);
  }
  if (patch.title !== undefined) {
    sets.push("title = ?");
    params.push(patch.title.trim().slice(0, 200) || "Untitled conversation");
  }
  if (patch.courseId !== undefined) {
    sets.push("course_id = ?");
    params.push(patch.courseId);
  }
  if (patch.documentIds !== undefined) {
    sets.push("document_ids = ?");
    params.push(JSON.stringify(patch.documentIds));
  }
  if (patch.level !== undefined) {
    sets.push("level = ?");
    params.push(patch.level);
  }
  if (patch.language !== undefined) {
    sets.push("language = ?");
    params.push(patch.language);
  }
  if (!sets.length) return;
  sets.push("updated_at = ?");
  params.push(now(), id);
  getDb().prepare(`UPDATE conversations SET ${sets.join(", ")} WHERE id = ?`).run(...params);
}

export function deleteConversation(id: number): boolean {
  return getDb().prepare("DELETE FROM conversations WHERE id = ?").run(id).changes > 0;
}

export function addMessage(
  conversationId: number,
  msg: { role: "user" | "assistant"; content: string; sources?: SourceRef[]; model?: string | null; meta?: MessageView["meta"] },
): MessageView {
  const ts = now();
  const res = getDb()
    .prepare("INSERT INTO messages (conversation_id, role, content, sources, model, meta, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .run(conversationId, msg.role, msg.content, msg.sources ? JSON.stringify(msg.sources) : null, msg.model ?? null, msg.meta ? JSON.stringify(msg.meta) : null, ts);
  getDb().prepare("UPDATE conversations SET updated_at = ? WHERE id = ?").run(ts, conversationId);
  return toMessage(getDb().prepare("SELECT * FROM messages WHERE id = ?").get<MsgRow>(res.lastInsertRowid)!);
}
