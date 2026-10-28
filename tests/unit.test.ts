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
import { buildFtsQuery, cosine } from "@/lib/retrieval/search";

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
