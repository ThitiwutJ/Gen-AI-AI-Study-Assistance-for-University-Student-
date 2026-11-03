/**
 * End-to-end tests of the server logic (upload → index → retrieve → tutor / summary / quiz / grading)
 * against scripts/mock-ollama.mjs — a TEST DOUBLE that speaks the Ollama API. These tests prove the
 * plumbing (num_ctx sent, citations checked, JSON validated, errors handled); they do not measure
 * answer quality. Real-model checks: `npm run check:ai` on a machine with Ollama.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startMockOllama } from "../scripts/mock-ollama.mjs";

type Mock = { url: string; requests: { url: string; body: Record<string, unknown> }[]; close: () => Promise<void> };

let mock: Mock;
let dataDir: string;
let app: {
  ingest: typeof import("@/lib/documents/ingest");
  repo: typeof import("@/lib/documents/repo");
  service: typeof import("@/lib/ai/service");
  ollama: typeof import("@/lib/ai/ollama");
  indexer: typeof import("@/lib/retrieval/indexer");
  search: typeof import("@/lib/retrieval/search");
  convs: typeof import("@/lib/data/conversations");
  tutor: typeof import("@/lib/features/tutor");
  summaries: typeof import("@/lib/features/summaries");
  quizzes: typeof import("@/lib/features/quizzes");
  quizData: typeof import("@/lib/data/quizzes");
  notes: typeof import("@/lib/data/notes");
  jobs: typeof import("@/lib/jobs");
  settings: typeof import("@/lib/settings");
};

async function waitFor(check: () => boolean, ms = 10_000) {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > ms) throw new Error("timed out");
    await new Promise((r) => setTimeout(r, 20));
  }
}

function upload(name: string) {
  return app.ingest.ingestDocument({ file: { name, buffer: fs.readFileSync(path.join("samples", name)) } });
}

beforeAll(async () => {
  mock = await startMockOllama({ delayMs: 0, think: true });
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "genai-test-"));
  process.env.DATA_DIR = dataDir;
  process.env.OLLAMA_BASE_URL = mock.url;
  app = {
    ingest: await import("@/lib/documents/ingest"),
    repo: await import("@/lib/documents/repo"),
    service: await import("@/lib/ai/service"),
    ollama: await import("@/lib/ai/ollama"),
    indexer: await import("@/lib/retrieval/indexer"),
    search: await import("@/lib/retrieval/search"),
    convs: await import("@/lib/data/conversations"),
    tutor: await import("@/lib/features/tutor"),
    summaries: await import("@/lib/features/summaries"),
    quizzes: await import("@/lib/features/quizzes"),
    quizData: await import("@/lib/data/quizzes"),
    notes: await import("@/lib/data/notes"),
    jobs: await import("@/lib/jobs"),
    settings: await import("@/lib/settings"),
  };
  // Use the small chat model explicitly (the double also offers a thinking model).
  app.settings.saveSettings({ chatModel: "mock-chat:1b" });
});

afterAll(async () => {
  await mock.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

describe("AI status and model discovery", () => {
  it("discovers chat and embedding models from /api/tags and /api/show", async () => {
    const status = await app.service.getStatus(true);
    expect(status.state).toBe("connected");
    expect(status.chat.model).toBe("mock-chat:1b");
    expect(status.embed.model).toBe("mock-embed:latest");
    expect(status.embed.mode).toBe("semantic");
    expect(status.chat.contextLength).toBe(32768);
    expect(status.numCtx).toBe(8192);
  });

  it("reports a missing selected model instead of silently switching", async () => {
    app.settings.saveSettings({ chatModel: "does-not-exist:7b" });
    const status = await app.service.getStatus(true);
    expect(status.state).toBe("model_unavailable");
    expect(status.problems[0].fix).toContain("ollama pull does-not-exist:7b");
    app.settings.saveSettings({ chatModel: "mock-chat:1b" });
  });
});

describe("materials, indexing and retrieval", () => {
  it("uploads, chunks and embeds a PDF locally", async () => {
    const doc = await upload("fin101-time-value-of-money.pdf");
    expect(doc.unitKind).toBe("page");
    expect(doc.chunkCount).toBeGreaterThan(0);
    await waitFor(() => app.repo.getDocument(doc.id)?.indexStatus === "ready");
    const ready = app.repo.getDocument(doc.id)!;
    expect(ready.embedModel).toBe("mock-embed:latest");
    expect(ready.indexedChunks).toBe(ready.chunkCount);
  });

  it("finds a document-only fact with its real page number", async () => {
    const result = await app.search.retrieve("What happens if a problem set is late?", {});
    expect(result.mode).toBe("hybrid");
    expect(result.chunks[0].text).toContain("15%");
    expect(result.chunks[0].location).toBe("p. 4");
  });

  it("finds Thai text with a Thai question", async () => {
    const doc = await upload("fin101-compound-interest-thai.docx");
    await waitFor(() => app.repo.getDocument(doc.id)?.indexStatus === "ready");
    const result = await app.search.retrieve("การสอบย่อยครั้งที่ 2 จัดสัปดาห์ไหน", { documentIds: [doc.id] });
    expect(result.chunks.map((c) => c.text).join(" ")).toContain("สัปดาห์ที่ 9");
  });

  it("rejects unsupported and empty uploads with clear messages", async () => {
    await expect(app.ingest.ingestDocument({ file: { name: "virus.exe", buffer: Buffer.from("MZ") } })).rejects.toThrow(/supported/);
    await expect(app.ingest.ingestDocument({ file: { name: "empty.pdf", buffer: Buffer.alloc(0) } })).rejects.toThrow(/empty/);
    await expect(app.ingest.ingestDocument({ pastedText: "   " })).rejects.toThrow(/paste/);
  });

  it("deletes a document together with its chunks and stored file", async () => {
    const doc = await upload("study-skills-notes.md");
    await waitFor(() => app.repo.getDocument(doc.id)?.indexStatus === "ready");
    const files = fs.readdirSync(path.join(dataDir, "uploads")).length;
    expect(app.repo.deleteDocument(doc.id)).toBe(true);
    expect(fs.readdirSync(path.join(dataDir, "uploads")).length).toBe(files - 1);
    const hits = await app.search.retrieve("spaced repetition intervals", {});
    expect(hits.chunks.every((c) => c.documentId !== doc.id)).toBe(true);
  });
});

describe("AI tutor", () => {
  it("answers from the materials, keeps real citations and removes invented ones", async () => {
    const conv = app.convs.createConversation({ scope: "all" });
    const before = mock.requests.length;
    const job = app.tutor.askTutor(conv.id, { content: "What is the late penalty for problem sets?", scope: "all", level: "standard", language: "auto" });
    const done = await app.jobs.waitForJob(job.id);
    expect(done.status).toBe("done");
    const saved = app.convs.getConversation(conv.id)!;
    const answer = saved.messages[1];
    expect(answer.role).toBe("assistant");
    expect(answer.content).toContain("[S1]");
    expect(answer.content).not.toContain("[S9]");
    expect(answer.meta?.removedCitations).toEqual(["S9"]);
    expect(answer.meta?.grounding).toBe("materials");
    expect(answer.sources[0].location).toMatch(/^p\. \d/);
    expect(answer.sources.find((s) => s.label === "S1")?.cited).toBe(true);

    // Every chat request must carry an explicit context window.
    const chats = mock.requests.slice(before).filter((r) => r.url === "/api/chat");
    expect(chats.length).toBeGreaterThan(0);
    for (const r of chats) expect((r.body.options as { num_ctx?: number }).num_ctx).toBe(8192);
    // A non-thinking model must never be sent the `think` field.
    for (const r of chats) expect("think" in r.body).toBe(false);
  });

  it("answers from general knowledge when no materials are selected", async () => {
    const conv = app.convs.createConversation({ scope: "none" });
    const job = app.tutor.askTutor(conv.id, { content: "What is inflation?", scope: "none", level: "beginner", language: "en" });
    expect((await app.jobs.waitForJob(job.id)).status).toBe("done");
    const answer = app.convs.getConversation(conv.id)!.messages[1];
    expect(answer.meta?.grounding).toBe("general");
    expect(answer.sources).toHaveLength(0);
  });

  it("can retry the last question after a failure without retyping it", async () => {
    const conv = app.convs.createConversation({ scope: "all" });
    app.settings.saveSettings({ chatModel: "missing:1b" });
    const failed = await app.jobs.waitForJob(app.tutor.askTutor(conv.id, { content: "Explain discounting", scope: "all", level: "standard", language: "auto" }).id);
    expect(failed.status).toBe("error");
    expect(failed.error?.code).toBe("model_missing");
    expect(app.convs.getConversation(conv.id)!.messages.map((m) => m.role)).toEqual(["user"]);

    app.settings.saveSettings({ chatModel: "mock-chat:1b" });
    const retried = await app.jobs.waitForJob(app.tutor.askTutor(conv.id, { retry: true, scope: "all", level: "standard", language: "auto" }).id);
    expect(retried.status).toBe("done");
    expect(app.convs.getConversation(conv.id)!.messages.map((m) => m.role)).toEqual(["user", "assistant"]);
  });

  it("hides reasoning from thinking models and sends think=false", async () => {
    app.settings.saveSettings({ chatModel: "mock-think:4b" });
    const conv = app.convs.createConversation({ scope: "all" });
    const before = mock.requests.length;
    const job = app.tutor.askTutor(conv.id, { content: "Define present value", scope: "all", level: "standard", language: "en" });
    expect((await app.jobs.waitForJob(job.id)).status).toBe("done");
    const answer = app.convs.getConversation(conv.id)!.messages[1];
    expect(answer.content).not.toContain("mock reasoning");
    const chat = mock.requests.slice(before).find((r) => r.url === "/api/chat")!;
    expect(chat.body.think).toBe(false);
    app.settings.saveSettings({ chatModel: "mock-chat:1b" });
  });

  it("can be cancelled", async () => {
    const conv = app.convs.createConversation({ scope: "all" });
    const job = app.tutor.askTutor(conv.id, { content: "What is an annuity?", scope: "all", level: "standard", language: "en" });
    app.jobs.cancelJob(job.id);
    const done = await app.jobs.waitForJob(job.id);
    expect(done.status).toBe("cancelled");
  });
});

describe("document collection (lab 4, task 1)", () => {
  it("answers 'What are the papers in my document collection?' with file names, index status and opening excerpts", async () => {
    const conv = app.convs.createConversation({ scope: "all" });
    const before = mock.requests.length;
    const job = app.tutor.askTutor(conv.id, { content: "What are the papers in my document collection?", scope: "all", level: "standard", language: "auto" });
    expect((await app.jobs.waitForJob(job.id)).status).toBe("done");
    const answer = app.convs.getConversation(conv.id)!.messages[1];

    // What the model was given: every document with file name, status and opening excerpt.
    const chat = mock.requests.slice(before).find((r) => r.url === "/api/chat")!;
    const prompt = String((chat.body.messages as { content: string }[]).at(-1)!.content);
    expect(prompt).toContain("DOCUMENT COLLECTION:");
    expect(prompt).toContain("File: fin101-time-value-of-money.pdf");
    expect(prompt).toContain("File: fin101-compound-interest-thai.docx");
    expect(prompt).toMatch(/Status: Indexed · \d+ chunks/);
    expect(prompt).toContain("Opening excerpt:");
    expect(prompt).not.toContain("SOURCES:");

    // The answer names each file and keeps only real document citations.
    expect(answer.content).toContain("fin101-time-value-of-money.pdf");
    expect(answer.content).toMatch(/Indexed · \d+ chunks/);
    expect(answer.content).toContain("[D1]");
    expect(answer.content).not.toContain("[D99]");
    expect(answer.meta?.removedCitations).toEqual(["D99"]);
    expect(answer.meta?.grounding).toBe("materials");
    const docs = answer.sources.filter((s) => s.kind === "document");
    expect(docs.map((d) => d.fileName)).toEqual(["fin101-time-value-of-money.pdf", "fin101-compound-interest-thai.docx"]);
    expect(docs[0].status).toMatch(/^Indexed · \d+ chunks$/);
    expect(docs[0].excerpt.length).toBeGreaterThan(20);
  });

  it("lists only the selected documents when the question is limited to some materials", async () => {
    const pdf = app.repo.listDocuments().find((d) => d.fileType === "pdf")!;
    const conv = app.convs.createConversation({ scope: "documents", documentIds: [pdf.id] });
    const job = app.tutor.askTutor(conv.id, { content: "Which files did I upload?", scope: "documents", documentIds: [pdf.id], level: "standard", language: "en" });
    expect((await app.jobs.waitForJob(job.id)).status).toBe("done");
    const answer = app.convs.getConversation(conv.id)!.messages[1];
    expect(answer.sources.filter((s) => s.kind === "document").map((d) => d.documentId)).toEqual([pdf.id]);
  });

  it("names the document behind each passage in ordinary questions", async () => {
    const conv = app.convs.createConversation({ scope: "all" });
    const before = mock.requests.length;
    const job = app.tutor.askTutor(conv.id, { content: "What is the late penalty for problem sets?", scope: "all", level: "standard", language: "en" });
    expect((await app.jobs.waitForJob(job.id)).status).toBe("done");
    const chat = mock.requests.slice(before).find((r) => r.url === "/api/chat")!;
    const prompt = String((chat.body.messages as { content: string }[]).at(-1)!.content);
    expect(prompt).toContain("DOCUMENT COLLECTION:");
    expect(prompt).toContain("SOURCES:");
    expect(prompt).toMatch(/\[S1\] .*\(p\. 4, file fin101-time-value-of-money\.pdf\)/);
  });
});

describe("search depth and time limits (lab 4 hint)", () => {
  it("searches every document separately for questions about each paper", async () => {
    const conv = app.convs.createConversation({ scope: "all" });
    const job = app.tutor.askTutor(conv.id, { content: "Summarize the main idea of each document about interest", scope: "all", level: "standard", language: "en" });
    expect((await app.jobs.waitForJob(job.id)).status).toBe("done");
    const answer = app.convs.getConversation(conv.id)!.messages[1];
    expect(answer.meta?.searches).toBe(3); // the whole question + one per document
    expect(new Set(answer.sources.map((s) => s.documentId)).size).toBe(2);
  });

  it("searches each part of a multi-part question", async () => {
    const conv = app.convs.createConversation({ scope: "all" });
    const job = app.tutor.askTutor(conv.id, {
      content: "What is the late penalty for problem sets? When is the second quiz held?",
      scope: "all",
      level: "standard",
      language: "en",
    });
    expect((await app.jobs.waitForJob(job.id)).status).toBe("done");
    expect(app.convs.getConversation(conv.id)!.messages[1].meta?.searches).toBe(3);
  });

  it("uses the 'passages per answer' setting", async () => {
    app.settings.saveSettings({ passages: 2 });
    try {
      const conv = app.convs.createConversation({ scope: "all" });
      const job = app.tutor.askTutor(conv.id, { content: "Explain compound interest and present value", scope: "all", level: "standard", language: "en" });
      expect((await app.jobs.waitForJob(job.id)).status).toBe("done");
      const answer = app.convs.getConversation(conv.id)!.messages[1];
      expect(answer.sources.filter((s) => s.kind !== "document").length).toBeLessThanOrEqual(2);
      expect(answer.meta?.passages).toBeLessThanOrEqual(2);
    } finally {
      app.settings.saveSettings({ passages: 8 });
    }
  });

  it("stops a slow answer at the time limit with a clear message", async () => {
    const slow = await startMockOllama({ delayMs: 200 });
    try {
      const provider = new app.ollama.OllamaProvider(slow.url);
      await expect(
        provider.chat({ model: "mock-chat:1b", messages: [{ role: "user", content: "Hello" }], numCtx: 2048, timeoutMs: 150 }),
      ).rejects.toMatchObject({ code: "ai_timeout" });
    } finally {
      await slow.close();
    }
    expect(app.settings.getSettings().timeoutMinutes).toBe(10);
    expect(app.settings.saveSettings({ timeoutMinutes: 30 }).timeoutMinutes).toBe(30);
    expect(app.settings.answerTimeoutMs()).toBe(30 * 60_000);
    app.settings.saveSettings({ timeoutMinutes: 10 });
  });

  it("marks passages and questions for nomic-embed-text", async () => {
    const { embedPrefix } = await import("@/lib/ai/embed-prefix");
    expect(embedPrefix("nomic-embed-text:latest", "document")).toBe("search_document: ");
    expect(embedPrefix("nomic-embed-text:latest", "query")).toBe("search_query: ");
    expect(embedPrefix("qwen3-embedding:0.6b", "query")).toBe("");
  });
});

describe("original files (lab 4, task 2)", () => {
  async function getFile(id: number, query = "") {
    const route = await import("@/app/api/documents/[id]/file/route");
    return route.GET(new Request(`http://localhost/api/documents/${id}/file${query}`), { params: Promise.resolve({ id: String(id) }) } as never);
  }

  it("shows an uploaded PDF in the browser", async () => {
    const pdf = app.repo.listDocuments().find((d) => d.fileType === "pdf")!;
    expect(pdf.hasFile).toBe(true);
    const res = await getFile(pdf.id);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/pdf");
    expect(res.headers.get("content-disposition")).toMatch(/^inline; filename="fin101-time-value-of-money\.pdf"/);
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    const body = Buffer.from(await res.arrayBuffer());
    expect(body.subarray(0, 5).toString()).toBe("%PDF-");
    expect(body.equals(fs.readFileSync("samples/fin101-time-value-of-money.pdf"))).toBe(true);

    const download = await getFile(pdf.id, "?download=1");
    expect(download.headers.get("content-disposition")).toMatch(/^attachment;/);

    // The in-page viewer gets the bytes as JSON (download managers don't intercept JSON).
    const json = await (await getFile(pdf.id, "?format=base64")).json();
    expect(json.mime).toBe("application/pdf");
    expect(Buffer.from(json.data, "base64").equals(body)).toBe(true);
  });

  it("downloads Word files, keeping a Thai file name", async () => {
    const thaiName = "บทเรียน ดอกเบี้ยทบต้น.docx";
    const doc = await app.ingest.ingestDocument({ file: { name: thaiName, buffer: fs.readFileSync("samples/fin101-compound-interest-thai.docx") } });
    try {
      const res = await getFile(doc.id);
      expect(res.headers.get("content-type")).toBe("application/vnd.openxmlformats-officedocument.wordprocessingml.document");
      const disposition = res.headers.get("content-disposition")!;
      expect(disposition).toMatch(/^attachment;/);
      expect(disposition).toContain(`filename*=UTF-8''${encodeURIComponent(thaiName)}`);
      expect(/^[\x20-\x7e]*$/.test(disposition)).toBe(true); // header stays ASCII
    } finally {
      app.repo.deleteDocument(doc.id);
    }
  });

  it("explains that pasted notes have no original file, and 404s unknown materials", async () => {
    const pasted = await app.ingest.ingestDocument({ pastedText: "Opportunity cost is the value of the next best alternative given up.", title: "Pasted" });
    try {
      expect(pasted.hasFile).toBe(false);
      const res = await getFile(pasted.id);
      expect(res.status).toBe(404);
      expect((await res.json()).error.code).toBe("no_file");
    } finally {
      app.repo.deleteDocument(pasted.id);
    }
    expect((await getFile(999999)).status).toBe(404);
  });
});

describe("summaries", () => {
  it("creates a saved note and removes references to pages that don't exist", async () => {
    const doc = app.repo.listDocuments().find((d) => d.fileType === "pdf")!;
    const job = app.summaries.startSummaryJob({ documentId: doc.id, kind: "detailed", language: "en" });
    const done = await app.jobs.waitForJob(job.id);
    expect(done.status).toBe("done");
    const note = app.notes.getNote((done.result as { noteId: number }).noteId)!;
    expect(note.content).toContain("(page 1)");
    expect(note.content).not.toContain("999");
    expect(note.meta?.removedRefs?.length).toBe(1);
    expect(note.model).toBe("mock-chat:1b");
  });

  it("summarizes a long document in stages when it doesn't fit the context window", async () => {
    const long = Array.from({ length: 30 }, (_, i) => `## Topic ${i + 1}\n${`Detail sentence about topic ${i + 1}. `.repeat(120)}`).join("\n\n");
    const doc = await app.ingest.ingestDocument({ title: "Long lecture", pastedText: long });
    const job = app.summaries.startSummaryJob({ documentId: doc.id, kind: "quick", language: "en" });
    const done = await app.jobs.waitForJob(job.id, 60_000);
    expect(done.status).toBe("done");
    const note = app.notes.getNote((done.result as { noteId: number }).noteId)!;
    expect(note.meta?.staged).toBe(true);
    expect(note.meta?.parts).toBeGreaterThan(1);
  });
});

describe("quizzes and grading", () => {
  it("generates a validated quiz with the JSON schema in `format`", async () => {
    const doc = app.repo.listDocuments().find((d) => d.fileType === "pdf")!;
    const before = mock.requests.length;
    const job = app.quizzes.startQuizJob({ scope: "documents", documentIds: [doc.id], count: 6, difficulty: "medium", types: ["mcq", "tf", "short"], language: "en" });
    const done = await app.jobs.waitForJob(job.id);
    expect(done.status).toBe("done");
    const quiz = app.quizData.getQuiz((done.result as { quizId: number }).quizId)!;
    expect(quiz.questions).toHaveLength(6);
    for (const q of quiz.questions) {
      if (q.type === "mcq") expect(q.options).toContain(q.answer);
      if (q.type === "tf") expect(["True", "False"]).toContain(q.answer);
    }
    const chat = mock.requests.slice(before).find((r) => r.url === "/api/chat")!;
    expect((chat.body.format as { type: string }).type).toBe("object");
    expect(quiz.sources.length).toBeGreaterThan(0);

    // Grade: mcq/tf deterministically, short answers by the model (labelled as AI-graded).
    const answers: Record<string, string> = {};
    for (const q of quiz.questions) answers[q.id] = q.type === "short" ? "Something close" : q.answer;
    const graded = await app.jobs.waitForJob(app.quizzes.startAttemptJob(quiz.id, answers).id);
    expect(graded.status).toBe("done");
    const attempt = app.quizData.getAttempt((graded.result as { attemptId: number }).attemptId)!;
    const shortResults = attempt.results.filter((r) => quiz.questions.find((q) => q.id === r.questionId)?.type === "short");
    expect(shortResults.every((r) => r.aiGraded && r.verdict === "partial")).toBe(true);
    expect(attempt.score).toBe(4 + 0.5 * 2);
    expect(attempt.maxScore).toBe(6);
  });

  it("retries once when the model returns invalid JSON", async () => {
    const bad = await startMockOllama({ delayMs: 0, badJson: true });
    app.service.setProviderForTests(new app.ollama.OllamaProvider(bad.url));
    try {
      const before = bad.requests.length;
      const job = app.quizzes.startQuizJob({ scope: "topic", topic: "photosynthesis", count: 2, difficulty: "easy", types: ["tf"], language: "en" });
      const done = await app.jobs.waitForJob(job.id);
      expect(done.status).toBe("done");
      expect(bad.requests.slice(before).filter((r: { url: string }) => r.url === "/api/chat")).toHaveLength(2);
    } finally {
      app.service.setProviderForTests(undefined);
      await bad.close();
    }
  });
});

describe("when the local AI is unavailable", () => {
  it("reports 'not running' with start instructions, and saved content stays available", async () => {
    app.service.setProviderForTests(new app.ollama.OllamaProvider("http://127.0.0.1:9"));
    try {
      const status = await app.service.getStatus(true);
      expect(status.state).toBe("not_running");
      expect(status.problems[0].fix).toMatch(/ollama serve|Start menu/);
      const conv = app.convs.createConversation({ scope: "all" });
      const done = await app.jobs.waitForJob(app.tutor.askTutor(conv.id, { content: "Hello?", scope: "all", level: "standard", language: "en" }).id);
      expect(done.status).toBe("error");
      expect(done.error?.code).toBe("ai_not_running");
      expect(app.repo.listDocuments().length).toBeGreaterThan(0);
      expect(app.notes.listNotes().length).toBeGreaterThan(0);
    } finally {
      app.service.setProviderForTests(undefined);
    }
  });

  it("explains a model crash (GPU driver problem) instead of a raw error", async () => {
    const crashing = await startMockOllama({ delayMs: 0, gpuCrash: true });
    app.service.setProviderForTests(new app.ollama.OllamaProvider(crashing.url));
    try {
      const conv = app.convs.createConversation({ scope: "none" });
      const done = await app.jobs.waitForJob(app.tutor.askTutor(conv.id, { content: "Hello?", scope: "none", level: "standard", language: "en" }).id);
      expect(done.status).toBe("error");
      expect(done.error?.code).toBe("model_crashed");
      expect(done.error?.fix).toMatch(/driver/);
    } finally {
      app.service.setProviderForTests(undefined);
      await crashing.close();
    }
  });

  it("falls back to keyword search when no embedding model is installed", async () => {
    const noEmbed = await startMockOllama({ delayMs: 0, embed: false });
    app.service.setProviderForTests(new app.ollama.OllamaProvider(noEmbed.url));
    try {
      const status = await app.service.getStatus(true);
      expect(status.embed.mode).toBe("keyword");
      expect(status.problems.some((p) => p.code === "no_embed_model")).toBe(true);
      const result = await app.search.retrieve("late problem set penalty", {});
      expect(result.mode).toBe("keyword");
      expect(result.chunks[0].text).toContain("15%");
    } finally {
      app.service.setProviderForTests(undefined);
      await noEmbed.close();
    }
  });
});
