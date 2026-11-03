import { describe, expect, it } from "vitest";
import { estimateTokens } from "@/lib/ai/budget";
import { pickChatModel, pickEmbedModel } from "@/lib/ai/service";
import { extractJson } from "@/lib/ai/structured";
import { stripThinking } from "@/lib/ai/think";
import type { ProviderModel } from "@/lib/ai/types";
import { chunkUnits, formatLocation } from "@/lib/documents/chunk";
import { checkGarbled, detectLanguage } from "@/lib/documents/text-utils";
import { sanitizeUnitRefs } from "@/lib/features/summaries";
import { normalizeTrueFalse, validateQuestion } from "@/lib/features/quizzes";
import { sanitizeCitations } from "@/lib/retrieval/citations";
import { collectionBlock, isCollectionQuestion, isPerDocumentQuestion, type CollectionEntry } from "@/lib/retrieval/collection";
import { buildFtsQuery, cosine, searchQueries } from "@/lib/retrieval/search";
import type { DocumentSummary } from "@/lib/types";

const model = (name: string, extra: Partial<ProviderModel> = {}): ProviderModel => ({
  name,
  sizeBytes: null,
  parameterSize: null,
  family: null,
  capabilities: ["completion"],
  contextLength: null,
  isEmbedding: false,
  thinking: false,
  thinkingLevels: [],
  ...extra,
});

describe("thinking output", () => {
  it("removes <think> blocks from answers", () => {
    expect(stripThinking("<think>secret plan</think>The answer is 4.")).toEqual({ answer: "The answer is 4.", thinking: "secret plan" });
  });
  it("hides an unfinished <think> block while streaming", () => {
    expect(stripThinking("<think>still reasoning").answer).toBe("");
  });
  it("leaves normal answers alone", () => {
    expect(stripThinking("Plain answer").answer).toBe("Plain answer");
  });
});

describe("citations", () => {
  it("keeps supplied labels and removes invented ones", () => {
    const r = sanitizeCitations("Fact one [S1]. Fact two [S2, S7]. Made up [S9].", new Set(["S1", "S2"]));
    expect(r.text).toBe("Fact one [S1]. Fact two [S2]. Made up.");
    expect([...r.cited].sort()).toEqual(["S1", "S2"]);
    expect(r.removed.sort()).toEqual(["S7", "S9"]);
  });

  it("also checks document labels from the collection overview", () => {
    const r = sanitizeCitations("Two papers: A [D1] and B [D2, S1]. Invented [D7].", new Set(["D1", "D2", "S1"]));
    expect(r.text).toBe("Two papers: A [D1] and B [D2][S1]. Invented.");
    expect([...r.cited].sort()).toEqual(["D1", "D2", "S1"]);
    expect(r.removed).toEqual(["D7"]);
  });
});

describe("document collection questions", () => {
  it("recognises questions about the collection itself", () => {
    for (const q of [
      "What are the papers in my document collection?",
      "Which files did I upload?",
      "List all my documents",
      "How many PDFs do I have?",
      "what documents are there",
      "Show me my collection",
      "เอกสารที่อัปโหลดมีอะไรบ้าง",
      "มีไฟล์อะไรบ้าง",
    ]) {
      expect(isCollectionQuestion(q), q).toBe(true);
    }
    for (const q of ["What is the late penalty for problem sets?", "Explain compound interest", "What does the paper say about bias?", "การสอบย่อยครั้งที่ 2 จัดสัปดาห์ไหน"]) {
      expect(isCollectionQuestion(q), q).toBe(false);
    }
  });

  it("recognises questions that need every document", () => {
    expect(isPerDocumentQuestion("Summarize each paper in two sentences")).toBe(true);
    expect(isPerDocumentQuestion("Compare the papers on AI tutoring")).toBe(true);
    expect(isPerDocumentQuestion("สรุปแต่ละเอกสาร")).toBe(true);
    expect(isPerDocumentQuestion("What is present value?")).toBe(false);
  });

  it("splits multi-part questions into extra searches", () => {
    expect(searchQueries("What is present value?")).toEqual(["What is present value?"]);
    expect(searchQueries("What is present value? How is it discounted?")).toEqual([
      "What is present value? How is it discounted?",
      "What is present value?",
      "How is it discounted?",
    ]);
  });

  const entry = (i: number, opening = "x".repeat(400)): CollectionEntry => ({
    label: `D${i}`,
    doc: { id: i, title: `Paper ${i}`, fileName: `paper-${i}.pdf`, fileType: "pdf", unitKind: "page", unitCount: 10, sizeBytes: 300_000, courseName: null, description: null } as DocumentSummary,
    status: "Indexed · 20 chunks",
    opening,
  });

  it("fits the collection to the budget: excerpts go first, then documents", () => {
    const entries = [1, 2, 3, 4, 5].map((i) => entry(i));
    const full = collectionBlock(entries, 5000, true);
    expect(full.listed).toHaveLength(5);
    expect(full.text).toContain("The student has uploaded 5 documents:");
    expect(full.text).toContain("[D5] Paper 5\nFile: paper-5.pdf (PDF, 10 pages, 293.0 KB)\nStatus: Indexed · 20 chunks\nOpening excerpt:");

    const noExcerpts = collectionBlock(entries, 300, true);
    expect(noExcerpts.listed).toHaveLength(5);
    expect(noExcerpts.text).not.toContain("Opening excerpt");

    const partial = collectionBlock(entries, 90, true);
    expect(partial.listed.length).toBeLessThan(5);
    expect(partial.text).toMatch(/uploaded 5 documents \(the first \d are listed\)/);

    expect(collectionBlock(entries, 5000, false, true).text).toContain("The student selected 5 documents for this question:");
  });
});

describe("summary page references", () => {
  it("keeps references to real pages and removes invented ones", () => {
    const r = sanitizeUnitRefs("Point A (page 2). Point B (p. 40). Range (pp. 1–3).", new Set([1, 2, 3]), "page");
    expect(r.text).toBe("Point A (page 2). Point B. Range (pages 1–3).");
    expect(r.removed).toEqual(["(p. 40)"]);
  });
});

describe("chunking", () => {
  it("keeps page ranges and merges small consecutive units", () => {
    const chunks = chunkUnits([
      { index: 1, heading: "Title", text: "Short slide." },
      { index: 2, heading: null, text: "Another short slide." },
      { index: 3, heading: null, text: "Long text. ".repeat(400) },
    ]);
    expect(chunks[0].unitStart).toBe(1);
    expect(chunks[0].unitEnd).toBe(2);
    const fromPage3 = chunks.filter((c) => c.unitStart === 3);
    expect(fromPage3.length).toBeGreaterThan(1);
    for (const c of chunks) expect(c.tokens).toBeLessThanOrEqual(700);
  });
  it("splits Thai text without spaces at word boundaries", () => {
    const thai = "ดอกเบี้ยทบต้นคือดอกเบี้ยที่คิดจากเงินต้นรวมกับดอกเบี้ยที่ได้รับในงวดก่อนหน้า".repeat(60);
    const chunks = chunkUnits([{ index: 1, heading: null, text: thai }], { targetTokens: 300, maxTokens: 400 });
    expect(chunks.length).toBeGreaterThan(2);
    // No chunk should start or end in the middle of a Thai combining mark sequence.
    for (const c of chunks) expect(/^[ัิ-ฺ็-๎]/.test(c.text)).toBe(false);
  });
  it("formats locations from metadata", () => {
    expect(formatLocation("page", 3, 3, null)).toBe("p. 3");
    expect(formatLocation("slide", 2, 4, null)).toBe("slides 2–4");
    expect(formatLocation("section", 1, 1, "Bonds")).toBe("section 1: Bonds");
  });
});

describe("keyword search query", () => {
  it("drops stopwords and quotes terms", () => {
    expect(buildFtsQuery("What is the late penalty for problem sets?")).toBe('"late" OR "penalty" OR "problem" OR "sets"');
  });
  it("handles Thai without spaces", () => {
    const q = buildFtsQuery("การสอบย่อยครั้งที่ 2 จัดสัปดาห์ไหน");
    expect(q).toContain('"สอบ');
    expect(q).not.toBeNull();
  });
  it("returns null when nothing is searchable", () => {
    expect(buildFtsQuery("is it?")).toBeNull();
  });
});

describe("quiz validation", () => {
  const labels = new Set(["S1"]);
  it("accepts a valid multiple-choice question and maps letter answers", () => {
    const r = validateQuestion({ type: "mcq", question: "What is 2 + 2?", options: ["A) 3", "B) 4", "C) 5", "D) 6"], answer: "B", explanation: "Arithmetic.", source: "S1" }, labels);
    expect(r.ok && r.question.answer).toBe("4");
  });
  it("rejects an answer that isn't an option", () => {
    const r = validateQuestion({ type: "mcq", question: "What is 2 + 2?", options: ["3", "5", "6", "7"], answer: "4", explanation: "", source: "S1" }, labels);
    expect(r.ok).toBe(false);
  });
  it("drops invented source labels", () => {
    const r = validateQuestion({ type: "tf", question: "The sky is green.", options: [], answer: "false", explanation: "", source: "S8" }, labels);
    expect(r.ok && r.question.source).toBe("");
    expect(r.ok && r.question.answer).toBe("False");
  });
  it("understands Thai true/false", () => {
    expect(normalizeTrueFalse("ถูก")).toBe("True");
    expect(normalizeTrueFalse("เท็จ")).toBe("False");
  });
});

describe("text quality and language", () => {
  it("flags private-use-area garbage from legacy Thai PDF fonts", () => {
    const garbage = " ".repeat(30) + "some text";
    expect(checkGarbled(garbage).garbled).toBe(true);
  });
  it("flags Thai tone marks that don't follow a consonant", () => {
    const broken = "่ ้ ๊ ิ ี ึ ื ั ็ ่ ้ ".repeat(10) + "กขค";
    expect(checkGarbled(broken).garbled).toBe(true);
  });
  it("accepts normal Thai and English", () => {
    expect(checkGarbled("ดอกเบี้ยทบต้นคือดอกเบี้ยที่คิดจากเงินต้นรวมกับดอกเบี้ยเดิม".repeat(5)).garbled).toBe(false);
    expect(checkGarbled("The time value of money is a core idea in finance. ".repeat(5)).garbled).toBe(false);
  });
  it("detects language", () => {
    expect(detectLanguage("ดอกเบี้ยทบต้นคือดอกเบี้ย")).toBe("th");
    expect(detectLanguage("Compound interest")).toBe("en");
  });
  it("estimates Thai as more token-hungry than English", () => {
    expect(estimateTokens("ดอกเบี้ยทบต้น")).toBeGreaterThan(estimateTokens("compound"));
  });
});

describe("structured output parsing", () => {
  it("parses JSON wrapped in code fences or text", () => {
    expect(extractJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(extractJson('Here you go: {"a":2} thanks')).toEqual({ a: 2 });
    expect(() => extractJson("no json")).toThrow();
  });
});

describe("model choice", () => {
  it("prefers a laptop-sized chat model and skips embedding models", () => {
    const models = [
      model("tiny:1b", { parameterSize: "1B" }),
      model("good:4b", { parameterSize: "4.3B" }),
      model("huge:70b", { parameterSize: "70B" }),
      model("nomic-embed-text:latest", { isEmbedding: true, capabilities: ["embedding"] }),
    ];
    expect(pickChatModel(models)?.name).toBe("good:4b");
    expect(pickChatModel([model("tiny:1b", { parameterSize: "999.89M" })])?.name).toBe("tiny:1b");
  });
  it("prefers multilingual embedding models", () => {
    const models = [
      model("nomic-embed-text:latest", { isEmbedding: true }),
      model("bge-m3:latest", { isEmbedding: true }),
    ];
    expect(pickEmbedModel(models)?.name).toBe("bge-m3:latest");
  });
  it("computes cosine similarity", () => {
    expect(cosine([1, 0], [1, 0])).toBeCloseTo(1);
    expect(cosine([1, 0], [0, 1])).toBeCloseTo(0);
  });
});
