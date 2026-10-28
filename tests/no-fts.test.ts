/**
 * Some SQLite builds (e.g. the one built into Node.js 22.15 on Windows) have no FTS5 module.
 * Gen AI must still upload, index and search materials, and rebuild the FTS index once FTS5 is
 * available again. FTS5 is switched off here with GENAI_DISABLE_FTS=1.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startMockOllama } from "../scripts/mock-ollama.mjs";

type Mock = { url: string; close: () => Promise<void> };
let mock: Mock;
let dataDir: string;

beforeAll(async () => {
  mock = await startMockOllama({ delayMs: 0, embed: false });
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "genai-nofts-"));
  process.env.DATA_DIR = dataDir;
  process.env.OLLAMA_BASE_URL = mock.url;
  process.env.GENAI_DISABLE_FTS = "1";
});

afterAll(async () => {
  await mock.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

describe("without the FTS5 module", () => {
  it("uploads, searches English and Thai, and rebuilds the index when FTS5 returns", async () => {
    const db = await import("@/lib/db");
    const { ingestDocument } = await import("@/lib/documents/ingest");
    const { retrieve } = await import("@/lib/retrieval/search");
    const { deleteDocument } = await import("@/lib/documents/repo");

    expect(db.hasFullText()).toBe(false);
    const pdf = await ingestDocument({ file: { name: "a.pdf", buffer: fs.readFileSync("samples/fin101-time-value-of-money.pdf") } });
    const thai = await ingestDocument({ file: { name: "b.docx", buffer: fs.readFileSync("samples/fin101-compound-interest-thai.docx") } });

    const english = await retrieve("What is the late penalty for problem sets?", {});
    expect(english.mode).toBe("keyword");
    expect(english.chunks[0].text).toContain("15%");
    expect(english.chunks[0].location).toBe("p. 4");

    const thaiResult = await retrieve("การสอบย่อยครั้งที่ 2 จัดสัปดาห์ไหน", { documentIds: [thai.id] });
    expect(thaiResult.chunks.map((c) => c.text).join(" ")).toContain("สัปดาห์ที่ 9");

    expect(deleteDocument(thai.id)).toBe(true);

    // FTS5 becomes available (e.g. Node.js was updated): the index is rebuilt from existing chunks.
    db.resetDbForTests();
    delete process.env.GENAI_DISABLE_FTS;
    expect(db.hasFullText()).toBe(true);
    const ftsHits = db
      .getDb()
      .prepare("SELECT c.document_id AS doc FROM chunks_fts JOIN chunks c ON c.id = chunks_fts.rowid WHERE chunks_fts MATCH ?")
      .all<{ doc: number }>('"late problem set"');
    expect(ftsHits.map((h) => h.doc)).toContain(pdf.id);
  });
});
