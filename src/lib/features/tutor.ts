import { estimateTokens, fitInOrder, fitRecent, promptBudget } from "@/lib/ai/budget";
import { generate, getProvider, requireChatModel } from "@/lib/ai/service";
import type { ChatMessage } from "@/lib/ai/types";
import { addMessage, getConversation, updateConversation } from "@/lib/data/conversations";
import { AppError } from "@/lib/errors";
import { startJob } from "@/lib/jobs";
import { labelChunks, sanitizeCitations, sourcesBlock, toSourceRefs } from "@/lib/retrieval/citations";
import { buildCollection, collectionBlock, collectionSourceRefs, isCollectionQuestion, isPerDocumentQuestion, type CollectionEntry } from "@/lib/retrieval/collection";
import { multiRetrieve, searchQueries, type Scope } from "@/lib/retrieval/search";
import { getSettings } from "@/lib/settings";
import type { ContextScope, JobView, LanguagePref, Level, MessageView } from "@/lib/types";
import { resolveLanguage, tutorSystemPrompt, tutorUserMessage } from "./prompts";

export interface AskInput {
  content?: string;
  scope: ContextScope;
  courseId?: number | null;
  documentIds?: number[];
  level: Level;
  language: LanguagePref;
  /** Answer the last unanswered question again (after an error or timeout). */
  retry?: boolean;
}

const ANSWER_TOKENS: Record<Level, number> = { beginner: 1024, standard: 1024, exam: 1400 };

function scopeFor(input: AskInput): Scope | null {
  switch (input.scope) {
    case "none":
      return null;
    case "course":
      return input.courseId ? { courseId: input.courseId } : {};
    case "documents":
      return { documentIds: input.documentIds ?? [] };
    default:
      return {};
  }
}

export function askTutor(conversationId: number, input: AskInput): JobView<{ message: MessageView }> {
  const conversation = getConversation(conversationId);
  if (!conversation) throw new AppError("not_found", "This conversation no longer exists.", 404);

  updateConversation(conversationId, {
    scope: input.scope,
    courseId: input.scope === "course" ? (input.courseId ?? null) : null,
    documentIds: input.scope === "documents" ? (input.documentIds ?? []) : [],
    level: input.level,
    language: input.language,
  });

  let question: string;
  if (input.retry) {
    const last = conversation.messages[conversation.messages.length - 1];
    if (!last || last.role !== "user") throw new AppError("nothing_to_retry", "There's no unanswered question to retry.", 400);
    question = last.content;
  } else {
    question = (input.content ?? "").trim();
    if (!question) throw new AppError("invalid_input", "Type a question first.", 400);
    if (question.length > 8000) throw new AppError("invalid_input", "That question is too long. Keep it under 8,000 characters.", 400);
    addMessage(conversationId, { role: "user", content: question });
    if (conversation.messages.length === 0) {
      updateConversation(conversationId, { title: question.replace(/\s+/g, " ").slice(0, 70) });
    }
  }

  const history = conversation.messages.filter((m, i, all) => !(input.retry && i === all.length - 1));

  return startJob("tutor", async (ctx) => {
    const { model, numCtx } = await requireChatModel();
    const scope = scopeFor(input);
    const grounded = scope !== null;
    const lang = resolveLanguage(input.language, question);

    // Short follow-ups ("give me an example") are searched together with the previous question.
    const previousQuestion = [...history].reverse().find((m) => m.role === "user")?.content;
    const searchQuery = previousQuestion && estimateTokens(question) < 16 ? `${previousQuestion}\n${question}` : question;

    let labelled: ReturnType<typeof labelChunks> = [];
    let listed: CollectionEntry[] = [];
    let collectionText: string | null = null;
    let retrievalMode: "hybrid" | "keyword" | "vector" | "none" = "none";
    let searches = 0;
    const numPredict = ANSWER_TOKENS[input.level];
    // "What are the papers in my document collection?" is answered from the collection overview.
    const collectionQuestion = grounded && isCollectionQuestion(question);
    const system = tutorSystemPrompt({ level: input.level, lang, grounded, collectionQuestion });
    let budget = promptBudget(numCtx, numPredict) - estimateTokens(system) - estimateTokens(question) - 40;

    if (scope) {
      ctx.setStage("searching");
      // The documents the tutor can see, so it can name them: with opening excerpts for questions
      // about the collection, a short list otherwise.
      const entries = buildCollection(scope, collectionQuestion ? 600 : 0);
      const block = collectionBlock(entries, Math.floor(budget * (collectionQuestion ? 0.7 : 0.12)), collectionQuestion, input.scope !== "all");
      listed = block.listed;
      collectionText = block.text;
      budget -= estimateTokens(block.text);

      if (!collectionQuestion) {
        // More searches for harder questions: each part of a multi-part question, and one search
        // per document when the question is about every document.
        const { passages } = getSettings();
        const result = await multiRetrieve(searchQueries(searchQuery), scope, {
          limit: passages,
          perDocument: isPerDocumentQuestion(question),
          signal: ctx.signal,
        });
        retrievalMode = result.mode;
        searches = result.searches;
        // Sources get up to 65% of what's left; history gets the rest.
        const fitted = fitInOrder(result.chunks, (c) => `${c.documentTitle} ${c.location}\n${c.text}`, Math.floor(budget * 0.65));
        labelled = labelChunks(fitted.kept);
        budget -= fitted.used + labelled.length * 12;
      }
    }

    const turns = history
      .filter((m) => m.content.trim())
      .map<ChatMessage>((m) => ({ role: m.role, content: m.content }));
    const recent = fitRecent(turns, (m) => m.content, Math.max(0, budget)).kept;
    // Keep alternation clean: history must not end with an unanswered user turn.
    while (recent.length && recent[recent.length - 1].role === "user") recent.pop();

    const messages: ChatMessage[] = [
      { role: "system", content: system },
      ...recent,
      {
        role: "user",
        content: tutorUserMessage(question, grounded && !collectionQuestion ? sourcesBlock(labelled) : null, grounded ? collectionText : null),
      },
    ];

    const loaded = await getProvider().loadedModels();
    ctx.setStage(loaded.includes(model.name) || getProvider().kind !== "ollama" ? "waiting" : "loading_model");

    const result = await generate({
      messages,
      numPredict,
      temperature: 0.4,
      signal: ctx.signal,
      onFirstToken: () => ctx.setStage("generating"),
      onToken: (partial, tokens) => ctx.setPartial(partial, tokens),
    });

    const valid = new Set([...labelled.map((l) => l.label), ...listed.map((e) => e.label)]);
    const cleaned = sanitizeCitations(result.content, valid);
    const sources = [...toSourceRefs(labelled, cleaned.cited), ...collectionSourceRefs(listed, cleaned.cited, collectionQuestion)];
    // Describe what the answer actually did: cited the materials, said they don't cover it, or neither.
    const saysNotCovered = /(materials|sources) (don't|do not|doesn't|does not) (cover|contain|mention)|ไม่ครอบคลุม|ไม่มีข้อมูล/i.test(cleaned.text.slice(0, 400));
    const grounding = !grounded
      ? "general"
      : collectionQuestion && listed.length
        ? "materials"
        : !labelled.length || (saysNotCovered && cleaned.cited.size === 0)
          ? "not_found"
          : cleaned.cited.size > 0
            ? "materials"
            : "uncited";
    const content = cleaned.text.trim() || "The model returned an empty answer. Try asking again or rephrasing the question.";

    const message = addMessage(conversationId, {
      role: "assistant",
      content,
      sources,
      model: result.model,
      meta: {
        grounding,
        retrievalMode,
        level: input.level,
        promptTokens: result.promptTokens ?? undefined,
        numCtx: result.numCtx,
        removedCitations: cleaned.removed.length ? cleaned.removed : undefined,
        searches: grounded ? searches : undefined,
        passages: grounded ? labelled.length : undefined,
        collection: grounded ? listed.length : undefined,
      },
    });
    return { message };
  });
}
