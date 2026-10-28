/** Types shared between the server (API routes) and the browser (pages). */

export type UnitKind = "page" | "slide" | "section";
export type FileType = "pdf" | "docx" | "pptx" | "txt" | "md" | "paste";
export type IndexStatus = "pending" | "indexing" | "ready" | "keyword_only" | "failed" | "stale" | "skipped";
export type Level = "beginner" | "standard" | "exam";
export type LanguagePref = "auto" | "en" | "th";
export type NoteKind = "quick" | "detailed" | "exam" | "beginner" | "topics";
export type Difficulty = "easy" | "medium" | "hard";
export type QuestionType = "mcq" | "tf" | "short";

export interface ApiErrorBody {
  error: { code: string; message: string; fix?: string };
}

export interface Course {
  id: number;
  name: string;
  code: string | null;
  createdAt: string;
  documentCount: number;
}

export interface DocumentSummary {
  id: number;
  courseId: number | null;
  courseName: string | null;
  title: string;
  description: string | null;
  fileName: string | null;
  fileType: FileType;
  sizeBytes: number | null;
  language: string | null;
  unitKind: UnitKind;
  unitCount: number;
  wordCount: number;
  chunkCount: number;
  warning: string | null;
  searchable: boolean;
  indexStatus: IndexStatus;
  indexError: string | null;
  embedModel: string | null;
  indexedChunks: number;
  createdAt: string;
  updatedAt: string;
  lastOpenedAt: string | null;
}

export interface DocumentUnit {
  index: number;
  label: string;
  heading: string | null;
  text: string;
}

export interface DocumentDetail extends DocumentSummary {
  units: DocumentUnit[];
}

/** A retrieved excerpt shown under an answer. Location data always comes from stored metadata. */
export interface SourceRef {
  label: string; // "S1"
  chunkId: number;
  documentId: number;
  documentTitle: string;
  location: string; // "p. 3", "slides 2–4", "section: Bonds"
  unitStart: number;
  excerpt: string;
  cited: boolean;
  score?: number;
}

export interface MessageView {
  id: number;
  role: "user" | "assistant";
  content: string;
  sources: SourceRef[];
  model: string | null;
  meta: {
    grounding?: "materials" | "uncited" | "not_found" | "general";
    retrievalMode?: "hybrid" | "keyword" | "vector" | "none";
    level?: Level;
    promptTokens?: number;
    numCtx?: number;
    removedCitations?: string[];
  } | null;
  createdAt: string;
}

export type ContextScope = "none" | "all" | "course" | "documents";

export interface ConversationSummary {
  id: number;
  title: string;
  scope: ContextScope;
  courseId: number | null;
  documentIds: number[];
  level: Level;
  language: LanguagePref;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
}

export interface ConversationDetail extends ConversationSummary {
  messages: MessageView[];
}

export interface NoteSummary {
  id: number;
  title: string;
  kind: NoteKind;
  documentId: number | null;
  documentTitle: string | null;
  courseId: number | null;
  courseName: string | null;
  model: string | null;
  language: string | null;
  createdAt: string;
  updatedAt: string;
  preview: string;
}

export interface NoteDetail extends NoteSummary {
  content: string;
  meta: { staged?: boolean; parts?: number; removedRefs?: string[]; unitKind?: UnitKind } | null;
}

export interface QuizQuestion {
  id: string;
  type: QuestionType;
  question: string;
  options: string[];
  answer: string;
  explanation: string;
  source: string; // "S2" or ""
}

export interface QuizSummary {
  id: number;
  title: string;
  courseId: number | null;
  courseName: string | null;
  documentIds: number[];
  topic: string | null;
  difficulty: Difficulty;
  language: string | null;
  questionCount: number;
  model: string | null;
  createdAt: string;
  attemptCount: number;
  lastScore: number | null;
  lastMaxScore: number | null;
}

export interface QuizDetail extends QuizSummary {
  questions: QuizQuestion[];
  sources: SourceRef[];
  meta: { requested?: number; generated?: number; removed?: number; grounding?: "materials" | "general" } | null;
  attempts: AttemptSummary[];
  marked: string[];
}

export interface QuestionResult {
  questionId: string;
  given: string;
  correct: boolean;
  verdict: "correct" | "partial" | "incorrect" | "ungraded";
  score: number; // 0..1
  feedback: string | null;
  aiGraded: boolean;
}

export interface AttemptSummary {
  id: number;
  quizId: number;
  score: number;
  maxScore: number;
  ungraded: number;
  createdAt: string;
}

export interface AttemptDetail extends AttemptSummary {
  quizTitle: string;
  questions: QuizQuestion[];
  sources: SourceRef[];
  results: QuestionResult[];
  model: string | null;
}

export interface ModelView {
  name: string;
  sizeBytes: number | null;
  parameterSize: string | null;
  family: string | null;
  capabilities: string[];
  contextLength: number | null;
  isEmbedding: boolean;
  thinking: boolean;
}

export type ConnectionState = "connected" | "not_running" | "model_unavailable" | "no_models" | "error";

export interface AIProblem {
  code: string;
  message: string;
  fix?: string;
}

export interface AIStatus {
  provider: "ollama" | "openai-compatible";
  baseUrl: string;
  state: ConnectionState;
  version: string | null;
  models: ModelView[];
  chat: {
    model: string | null;
    source: "settings" | "env" | "auto" | null;
    available: boolean;
    contextLength: number | null;
    thinking: boolean;
  };
  embed: {
    model: string | null;
    source: "settings" | "env" | "auto" | "off" | null;
    available: boolean;
    mode: "semantic" | "keyword";
  };
  loadedModels: string[];
  numCtx: number;
  problems: AIProblem[];
  staleDocuments: number;
  checkedAt: string;
}

export interface SettingsView {
  displayName: string;
  chatModel: string; // "" = automatic
  embedModel: string; // "" = automatic, "none" = keyword-only
  numCtx: number;
  defaultLanguage: LanguagePref;
}

export interface JobView<T = unknown> {
  id: string;
  kind: string;
  status: "running" | "done" | "error" | "cancelled";
  stage: string;
  progress: { done: number; total: number } | null;
  partial: string | null;
  tokens: number;
  result: T | null;
  error: { code: string; message: string; fix?: string } | null;
  startedAt: string;
}

export interface DashboardData {
  displayName: string;
  counts: { courses: number; documents: number; notes: number; quizzes: number; attempts: number; conversations: number };
  courses: Course[];
  recentDocuments: DocumentSummary[];
  recentNotes: NoteSummary[];
  recentAttempts: (AttemptSummary & { quizTitle: string })[];
  recentConversations: ConversationSummary[];
  averageScore: number | null;
}

export interface LibraryItem {
  type: "document" | "note" | "quiz" | "conversation";
  id: number;
  title: string;
  courseName: string | null;
  updatedAt: string;
  snippet: string | null;
  href: string;
}
