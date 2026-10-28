import fs from "node:fs";
import path from "node:path";
import { config } from "@/lib/config";
import { openDatabase, type Database } from "./sqlite";

const SCHEMA_VERSION = 1;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);

CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);

CREATE TABLE IF NOT EXISTS courses (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  code TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS documents (
  id INTEGER PRIMARY KEY,
  course_id INTEGER REFERENCES courses(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  description TEXT,
  file_name TEXT,
  file_type TEXT NOT NULL,
  stored_name TEXT,
  size_bytes INTEGER,
  language TEXT,
  unit_kind TEXT NOT NULL,
  unit_count INTEGER NOT NULL DEFAULT 0,
  word_count INTEGER NOT NULL DEFAULT 0,
  chunk_count INTEGER NOT NULL DEFAULT 0,
  warning TEXT,
  searchable INTEGER NOT NULL DEFAULT 1,
  index_status TEXT NOT NULL DEFAULT 'pending',
  index_error TEXT,
  embed_model TEXT,
  indexed_chunks INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_opened_at TEXT
);

CREATE TABLE IF NOT EXISTS document_units (
  id INTEGER PRIMARY KEY,
  document_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  unit_index INTEGER NOT NULL,
  heading TEXT,
  text TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_units_doc ON document_units(document_id, unit_index);

CREATE TABLE IF NOT EXISTS chunks (
  id INTEGER PRIMARY KEY,
  document_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  unit_start INTEGER NOT NULL,
  unit_end INTEGER NOT NULL,
  heading TEXT,
  text TEXT NOT NULL,
  token_estimate INTEGER NOT NULL,
  embedding BLOB,
  embed_model TEXT,
  embed_dim INTEGER
);
CREATE INDEX IF NOT EXISTS idx_chunks_doc ON chunks(document_id, position);

CREATE TABLE IF NOT EXISTS notes (
  id INTEGER PRIMARY KEY,
  title TEXT NOT NULL,
  kind TEXT NOT NULL,
  content TEXT NOT NULL,
  document_id INTEGER REFERENCES documents(id) ON DELETE SET NULL,
  course_id INTEGER REFERENCES courses(id) ON DELETE SET NULL,
  model TEXT,
  language TEXT,
  meta TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS conversations (
  id INTEGER PRIMARY KEY,
  title TEXT NOT NULL,
  course_id INTEGER REFERENCES courses(id) ON DELETE SET NULL,
  document_ids TEXT NOT NULL DEFAULT '[]',
  scope TEXT NOT NULL DEFAULT 'all',
  level TEXT NOT NULL DEFAULT 'standard',
  language TEXT NOT NULL DEFAULT 'auto',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY,
  conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  sources TEXT,
  model TEXT,
  meta TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_messages_conv ON messages(conversation_id, id);

CREATE TABLE IF NOT EXISTS quizzes (
  id INTEGER PRIMARY KEY,
  title TEXT NOT NULL,
  course_id INTEGER REFERENCES courses(id) ON DELETE SET NULL,
  document_ids TEXT NOT NULL DEFAULT '[]',
  topic TEXT,
  difficulty TEXT NOT NULL,
  questions TEXT NOT NULL,
  sources TEXT NOT NULL DEFAULT '[]',
  model TEXT,
  language TEXT,
  meta TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS quiz_attempts (
  id INTEGER PRIMARY KEY,
  quiz_id INTEGER NOT NULL REFERENCES quizzes(id) ON DELETE CASCADE,
  answers TEXT NOT NULL,
  results TEXT NOT NULL,
  score REAL NOT NULL,
  max_score REAL NOT NULL,
  ungraded INTEGER NOT NULL DEFAULT 0,
  model TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_attempts_quiz ON quiz_attempts(quiz_id, id);

CREATE TABLE IF NOT EXISTS flashcard_marks (
  quiz_id INTEGER NOT NULL REFERENCES quizzes(id) ON DELETE CASCADE,
  question_id TEXT NOT NULL,
  marked INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (quiz_id, question_id)
);
`;

/**
 * Full-text keyword index (SQLite FTS5, trigram tokenizer so Thai works). Some SQLite builds —
 * e.g. the one built into Node.js 22.15 — don't include FTS5. Then Gen AI uses its own keyword
 * search instead (see retrieval/search.ts), and rebuilds the index if FTS5 becomes available later.
 */
const FTS_SCHEMA = `
CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(
  text, content='chunks', content_rowid='id', tokenize='trigram'
);
CREATE TRIGGER IF NOT EXISTS chunks_ai AFTER INSERT ON chunks BEGIN
  INSERT INTO chunks_fts(rowid, text) VALUES (new.id, new.text);
END;
CREATE TRIGGER IF NOT EXISTS chunks_ad AFTER DELETE ON chunks BEGIN
  INSERT INTO chunks_fts(chunks_fts, rowid, text) VALUES ('delete', old.id, old.text);
END;
CREATE TRIGGER IF NOT EXISTS chunks_au AFTER UPDATE OF text ON chunks BEGIN
  INSERT INTO chunks_fts(chunks_fts, rowid, text) VALUES ('delete', old.id, old.text);
  INSERT INTO chunks_fts(rowid, text) VALUES (new.id, new.text);
END;
`;

function setupFullText(db: Database): boolean {
  let available = process.env.GENAI_DISABLE_FTS !== "1";
  if (available) {
    try {
      db.exec(FTS_SCHEMA);
    } catch {
      available = false;
    }
  }
  const synced = db.prepare("SELECT value FROM meta WHERE key = 'fts_synced'").get<{ value: string }>()?.value === "1";
  if (available && !synced) {
    // Chunks may have been added while FTS5 was unavailable: rebuild the index from the chunks table.
    db.exec("INSERT INTO chunks_fts(chunks_fts) VALUES ('rebuild');");
  }
  if (!available) {
    // Without FTS5 the triggers would make every chunk insert fail.
    db.exec("DROP TRIGGER IF EXISTS chunks_ai; DROP TRIGGER IF EXISTS chunks_ad; DROP TRIGGER IF EXISTS chunks_au;");
  }
  db.prepare("INSERT INTO meta(key, value) VALUES ('fts_synced', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(available ? "1" : "0");
  return available;
}

type GlobalWithDb = typeof globalThis & { __genaiDb?: Database; __genaiFts?: boolean };

/** True when the SQLite FTS5 keyword index is available. */
export function hasFullText(): boolean {
  getDb();
  return Boolean((globalThis as GlobalWithDb).__genaiFts);
}

export function uploadsDir(): string {
  return path.join(config.dataDir, "uploads");
}

export function getDb(): Database {
  const g = globalThis as GlobalWithDb;
  if (g.__genaiDb) return g.__genaiDb;

  fs.mkdirSync(uploadsDir(), { recursive: true });
  const db = openDatabase(path.join(config.dataDir, "genai.db"));
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec("PRAGMA busy_timeout = 5000;");
  db.exec(SCHEMA);
  db.prepare("INSERT INTO meta(key, value) VALUES ('schema_version', ?) ON CONFLICT(key) DO NOTHING").run(
    String(SCHEMA_VERSION),
  );
  g.__genaiFts = setupFullText(db);
  // Anything left "indexing" by a previous process was interrupted.
  db.prepare("UPDATE documents SET index_status = 'pending' WHERE index_status = 'indexing'").run();
  g.__genaiDb = db;
  return db;
}

/** For tests: close and forget the current connection. */
export function resetDbForTests(): void {
  const g = globalThis as GlobalWithDb;
  g.__genaiDb?.close();
  g.__genaiDb = undefined;
  g.__genaiFts = undefined;
}

export function now(): string {
  return new Date().toISOString();
}

export function parseJson<T>(value: unknown, fallback: T): T {
  if (typeof value !== "string" || !value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}
