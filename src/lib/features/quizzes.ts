import { z } from "zod";
import { estimateTokens, fitInOrder, promptBudget } from "@/lib/ai/budget";
import { requireChatModel } from "@/lib/ai/service";
import { generateStructured } from "@/lib/ai/structured";
import { createAttempt, createQuiz, getQuiz } from "@/lib/data/quizzes";
import { getDocumentsByIds } from "@/lib/documents/repo";
import { aiErrors, AppError } from "@/lib/errors";
import { startJob } from "@/lib/jobs";
import { labelChunks, sourcesBlock, toSourceRefs } from "@/lib/retrieval/citations";
import { retrieve, sampleChunks, type RetrievedChunk, type Scope } from "@/lib/retrieval/search";
import type { Difficulty, JobView, LanguagePref, QuestionResult, QuestionType, QuizQuestion } from "@/lib/types";
import { gradingSystemPrompt, quizSystemPrompt, quizUserMessage, resolveLanguage, type Lang } from "./prompts";

// ---------- Schemas (also sent to the model as the JSON schema in `format`) ----------

export const GeneratedQuestionSchema = z.object({
  type: z.enum(["mcq", "tf", "short"]),
  question: z.string(),
  options: z.array(z.string()),
  answer: z.string(),
  explanation: z.string(),
  source: z.string(),
});
export const GeneratedQuizSchema = z.object({ questions: z.array(GeneratedQuestionSchema) });
type GeneratedQuestion = z.infer<typeof GeneratedQuestionSchema>;

export const GradeSchema = z.object({
  verdict: z.enum(["correct", "partial", "incorrect"]),
  score: z.number(),
  feedback: z.string(),
});

const TRUE_WORDS = ["true", "t", "จริง", "ถูก", "ถูกต้อง", "yes"];
const FALSE_WORDS = ["false", "f", "เท็จ", "ผิด", "ไม่ถูกต้อง", "no"];

function norm(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFC")
    .replace(/^[a-d][).:]\s+/i, "")
    .replace(/[\s.。]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeTrueFalse(value: string): "True" | "False" | null {
  const v = norm(value);
  if (TRUE_WORDS.includes(v)) return "True";
  if (FALSE_WORDS.includes(v)) return "False";
  return null;
}

/** Validate one generated question. Returns the cleaned question or a problem description. */
export function validateQuestion(
  q: GeneratedQuestion,
  validLabels: Set<string>,
): { ok: true; question: Omit<QuizQuestion, "id"> } | { ok: false; problem: string } {
  const text = q.question.trim();
  if (text.length < 5) return { ok: false, problem: "a question is empty" };
  const explanation = q.explanation.trim();
  const source = validLabels.has(q.source.trim().toUpperCase().replace(/[[\]]/g, "")) ? q.source.trim().toUpperCase().replace(/[[\]]/g, "") : "";

  if (q.type === "tf") {
    const answer = normalizeTrueFalse(q.answer);
    if (!answer) return { ok: false, problem: `true/false question "${text.slice(0, 50)}" has answer "${q.answer}" instead of True or False` };
    return { ok: true, question: { type: "tf", question: text, options: ["True", "False"], answer, explanation, source } };
  }

  if (q.type === "short") {
    const answer = q.answer.trim();
    if (!answer) return { ok: false, problem: `short-answer question "${text.slice(0, 50)}" has no model answer` };
    return { ok: true, question: { type: "short", question: text, options: [], answer, explanation, source } };
  }

  const options = q.options.map((o) => o.trim().replace(/^[A-Da-d][).:]\s+/, "")).filter(Boolean);
  const unique = [...new Map(options.map((o) => [norm(o), o])).values()];
  if (unique.length < 3 || unique.length > 6) {
    return { ok: false, problem: `multiple-choice question "${text.slice(0, 50)}" needs exactly 4 different options` };
  }
  let answer = unique.find((o) => norm(o) === norm(q.answer));
  if (!answer) {
    const letter = q.answer.trim().match(/^([A-Fa-f])(?:[).:]|$)/)?.[1];
    if (letter) answer = unique[letter.toUpperCase().charCodeAt(0) - 65];
  }
  if (!answer) return { ok: false, problem: `multiple-choice question "${text.slice(0, 50)}" has an answer that isn't one of its options` };
  return { ok: true, question: { type: "mcq", question: text, options: unique, answer, explanation, source } };
}

function distributeTypes(types: QuestionType[], count: number): QuestionType[] {
  const out: QuestionType[] = [];
  for (let i = 0; i < count; i++) out.push(types[i % types.length]);
  return out;
}

export interface QuizInput {
  scope: "documents" | "course" | "topic";
  documentIds?: number[];
  courseId?: number | null;
  topic?: string | null;
  count: number;
  difficulty: Difficulty;
  types: QuestionType[];
  language: LanguagePref;
}

const BATCH = 5;

export function startQuizJob(input: QuizInput): JobView<{ quizId: number }> {
  const count = Math.min(15, Math.max(1, Math.round(input.count)));
  const types = input.types.filter((t) => t === "mcq" || t === "tf" || t === "short");
  if (!types.length) throw new AppError("invalid_input", "Choose at least one question type.", 400);
  const topic = input.topic?.trim() || null;
  let scope: Scope | null = null;
  if (input.scope === "documents") {
    if (!input.documentIds?.length) throw new AppError("invalid_input", "Choose at least one material.", 400);
    scope = { documentIds: input.documentIds };
  } else if (input.scope === "course") {
    if (!input.courseId) throw new AppError("invalid_input", "Choose a course.", 400);
    scope = { courseId: input.courseId };
  } else if (!topic) {
    throw new AppError("invalid_input", "Enter a topic, or choose materials to generate questions from.", 400);
  }

  return startJob("quiz", async (ctx) => {
    const { numCtx } = await requireChatModel();
    ctx.setStage("searching");

    let chunks: RetrievedChunk[] = [];
    if (scope) {
      chunks = topic ? (await retrieve(topic, scope, { limit: 10, signal: ctx.signal })).chunks : sampleChunks(scope, 12);
      if (!chunks.length) {
        throw new AppError(
          "no_material",
          topic ? `Nothing about “${topic}” was found in the selected materials.` : "The selected materials have no readable text to make questions from.",
          422,
          topic ? "Try a different topic, choose other materials, or leave the topic empty to cover the whole material." : undefined,
        );
      }
    }
    const grounded = scope !== null;
    const labelled = labelChunks(chunks);
    const validLabels = new Set(labelled.map((l) => l.label));
    const sample = chunks.map((c) => c.text).join(" ").slice(0, 3000) || topic || "";
    const lang: Lang = resolveLanguage(input.language, sample);
    const system = quizSystemPrompt(input.difficulty, lang, grounded);

    const plan = distributeTypes(types, count);
    const batches: QuestionType[][] = [];
    for (let i = 0; i < plan.length; i += BATCH) batches.push(plan.slice(i, i + BATCH));

    const accepted: Omit<QuizQuestion, "id">[] = [];
    const seen = new Set<string>();
    let removed = 0;
    let model = "";

    for (let b = 0; b < batches.length; b++) {
      ctx.setProgress(b, batches.length);
      ctx.setStage(batches.length > 1 ? `questions ${b * BATCH + 1}–${b * BATCH + batches[b].length}` : "generating");
      const numPredict = Math.min(3000, 380 * batches[b].length + 200);
      const budget = promptBudget(numCtx, numPredict) - estimateTokens(system) - 150;
      // Rotate through the material so different batches cover different parts.
      const rotated = labelled.length ? [...labelled.slice((b * 3) % labelled.length), ...labelled.slice(0, (b * 3) % labelled.length)] : [];
      const fitted = fitInOrder(rotated, (l) => `[${l.label}] ${l.chunk.documentTitle} (${l.chunk.location})\n${l.chunk.text}`, budget).kept;
      const user = quizUserMessage({ sources: grounded ? sourcesBlock(fitted) : null, topic, types: batches[b] });

      const result = await generateStructured({
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        schema: GeneratedQuizSchema,
        numPredict,
        signal: ctx.signal,
        onFirstToken: () => ctx.setStage(batches.length > 1 ? `questions ${b * BATCH + 1}–${b * BATCH + batches[b].length}` : "generating"),
        check: (value) => {
          const problems = value.questions.map((q) => validateQuestion(q, validLabels)).filter((r) => !r.ok).map((r) => (r as { problem: string }).problem);
          const valid = value.questions.length - problems.length;
          if (valid < batches[b].length) problems.push(`${valid} valid questions were returned but ${batches[b].length} are needed`);
          return problems;
        },
      });
      model = result.model;
      for (const q of result.value.questions) {
        const checked = validateQuestion(q, validLabels);
        if (!checked.ok) {
          removed++;
          continue;
        }
        const key = checked.question.question.toLowerCase();
        if (seen.has(key)) {
          removed++;
          continue;
        }
        seen.add(key);
        accepted.push(checked.question);
      }
    }

    const questions: QuizQuestion[] = accepted.slice(0, count).map((q, i) => ({ ...q, id: `q${i + 1}` }));
    if (!questions.length) throw aiErrors.invalidOutput("no usable questions were produced");

    const docs = input.scope === "documents" ? getDocumentsByIds(input.documentIds ?? []) : [];
    const cited = new Set(questions.map((q) => q.source).filter(Boolean));
    const title = topic
      ? `Quiz: ${topic}`
      : docs.length
        ? `Quiz: ${docs[0].title}${docs.length > 1 ? ` + ${docs.length - 1} more` : ""}`
        : `Quiz: ${chunks[0]?.documentTitle ?? "Course materials"}`;
    const quiz = createQuiz({
      title,
      courseId: input.scope === "course" ? (input.courseId ?? null) : (docs[0]?.courseId ?? null),
      documentIds: input.scope === "documents" ? (input.documentIds ?? []) : [...new Set(chunks.map((c) => c.documentId))],
      topic,
      difficulty: input.difficulty,
      questions,
      sources: toSourceRefs(labelled.filter((l) => cited.has(l.label)), cited),
      model,
      language: lang,
      meta: { requested: count, generated: questions.length, removed, grounding: grounded ? "materials" : "general" },
    });
    ctx.setProgress(batches.length, batches.length);
    return { quizId: quiz.id };
  });
}

// ---------- Grading ----------

export function startAttemptJob(quizId: number, answers: Record<string, string>): JobView<{ attemptId: number }> {
  const quiz = getQuiz(quizId);
  if (!quiz) throw new AppError("not_found", "This quiz no longer exists.", 404);

  return startJob("grading", async (ctx) => {
    const results: QuestionResult[] = [];
    const shortCount = quiz.questions.filter((q) => q.type === "short" && answers[q.id]?.trim()).length;
    let gradedShort = 0;
    let model: string | null = null;
    const lang: Lang = quiz.language === "th" ? "th" : "en";

    for (const q of quiz.questions) {
      const given = (answers[q.id] ?? "").trim();
      if (!given) {
        results.push({ questionId: q.id, given: "", correct: false, verdict: "incorrect", score: 0, feedback: "No answer was given.", aiGraded: false });
        continue;
      }
      if (q.type === "mcq") {
        const correct = norm(given) === norm(q.answer);
        results.push({ questionId: q.id, given, correct, verdict: correct ? "correct" : "incorrect", score: correct ? 1 : 0, feedback: null, aiGraded: false });
        continue;
      }
      if (q.type === "tf") {
        const correct = normalizeTrueFalse(given) === q.answer;
        results.push({ questionId: q.id, given, correct, verdict: correct ? "correct" : "incorrect", score: correct ? 1 : 0, feedback: null, aiGraded: false });
        continue;
      }
      // Short answer: AI-assisted grading (a suggestion, labelled as such in the UI).
      ctx.setStage(`grading short answer ${gradedShort + 1} of ${shortCount}`);
      ctx.setProgress(gradedShort, shortCount);
      try {
        const source = quiz.sources.find((s) => s.label === q.source);
        const { value, model: m } = await generateStructured({
          messages: [
            { role: "system", content: gradingSystemPrompt(lang) },
            {
              role: "user",
              content: [
                `QUESTION: ${q.question}`,
                `MODEL ANSWER: ${q.answer}`,
                q.explanation ? `EXPLANATION: ${q.explanation}` : "",
                source ? `SOURCE EXCERPT: ${source.excerpt}` : "",
                `STUDENT ANSWER: ${given}`,
                'Return {"verdict": "correct" | "partial" | "incorrect", "score": 0 | 0.5 | 1, "feedback": "..."}.',
              ]
                .filter(Boolean)
                .join("\n\n"),
            },
          ],
          schema: GradeSchema,
          numPredict: 350,
          temperature: 0,
          signal: ctx.signal,
        });
        model = m;
        const score = value.verdict === "correct" ? 1 : value.verdict === "partial" ? 0.5 : 0;
        results.push({ questionId: q.id, given, correct: value.verdict === "correct", verdict: value.verdict, score, feedback: value.feedback.trim() || null, aiGraded: true });
      } catch (error) {
        if (ctx.signal.aborted) throw error;
        const reason = error instanceof AppError ? error.message : "the AI model wasn't available";
        results.push({
          questionId: q.id,
          given,
          correct: false,
          verdict: "ungraded",
          score: 0,
          feedback: `Couldn't grade this automatically (${reason}). Compare your answer with the model answer.`,
          aiGraded: false,
        });
      }
      gradedShort++;
    }

    const graded = results.filter((r) => r.verdict !== "ungraded");
    const attempt = createAttempt({
      quizId,
      answers,
      results,
      score: graded.reduce((sum, r) => sum + r.score, 0),
      maxScore: graded.length,
      ungraded: results.length - graded.length,
      model,
    });
    return { attemptId: attempt.id };
  });
}
