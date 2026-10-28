"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { ArrowLeft, ArrowRight, Bookmark, BookmarkCheck, Eye, RotateCcw } from "lucide-react";
import { JobProgress, useJobActivity } from "@/components/shared";
import { PageContainer } from "@/components/shell/AppShell";
import { useToast } from "@/components/shell/providers";
import { Badge, Button, ErrorNotice, Panel, PanelHeader, Segmented, Spinner, Textarea, cx, formatDate } from "@/components/ui";
import { api, ApiError, useApi, useJob } from "@/hooks/api";
import type { QuizDetail, QuizQuestion } from "@/lib/types";

const TYPE_LABEL = { mcq: "Multiple choice", tf: "True or false", short: "Short answer" } as const;

function QuestionInput({ q, value, onChange }: { q: QuizQuestion; value: string; onChange: (v: string) => void }) {
  if (q.type === "short") {
    return <Textarea rows={3} placeholder="Write your answer in your own words…" value={value} onChange={(e) => onChange(e.target.value)} aria-label="Your answer" />;
  }
  return (
    <div role="radiogroup" aria-label="Answer options" className={cx("grid gap-2", q.type === "tf" ? "grid-cols-2 sm:max-w-sm" : "")}>
      {q.options.map((option, i) => (
        <label
          key={option}
          className={cx(
            "flex cursor-pointer items-start gap-3 rounded-md border px-3 py-2.5 text-[15px]",
            value === option ? "border-action bg-action-soft" : "border-rule bg-surface hover:border-rule-strong",
          )}
        >
          <input type="radio" name={q.id} className="mt-1 accent-[var(--action)]" checked={value === option} onChange={() => onChange(option)} />
          <span>
            {q.type === "mcq" && <span className="mr-1.5 font-semibold text-ink-3">{String.fromCharCode(65 + i)}.</span>}
            {option}
          </span>
        </label>
      ))}
    </div>
  );
}

function Flashcards({ quiz, onMark }: { quiz: QuizDetail; onMark: (questionId: string, marked: boolean) => Promise<void> }) {
  const [onlyMarked, setOnlyMarked] = useState(false);
  const [index, setIndex] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const cards = onlyMarked ? quiz.questions.filter((q) => quiz.marked.includes(q.id)) : quiz.questions;
  const card = cards[Math.min(index, cards.length - 1)];
  const go = (delta: number) => {
    setIndex((i) => Math.max(0, Math.min(cards.length - 1, i + delta)));
    setRevealed(false);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <label className="flex items-center gap-2 text-sm text-ink-2">
          <input
            type="checkbox"
            className="accent-[var(--action)]"
            checked={onlyMarked}
            onChange={(e) => {
              setOnlyMarked(e.target.checked);
              setIndex(0);
              setRevealed(false);
            }}
          />
          Only cards marked for review ({quiz.marked.length})
        </label>
        {card && (
          <span className="text-sm tabular-nums text-ink-3">
            Card {Math.min(index, cards.length - 1) + 1} of {cards.length}
          </span>
        )}
      </div>
      {!card ? (
        <Panel className="p-8 text-center text-sm text-ink-2">No cards are marked for review yet.</Panel>
      ) : (
        <Panel className="flex min-h-[300px] flex-col p-6 sm:p-8">
          <p className="text-xs font-medium text-ink-3">{TYPE_LABEL[card.type]}</p>
          <p className="mt-2 font-[family-name:var(--font-reading)] text-xl leading-relaxed text-ink">{card.question}</p>
          {card.type === "mcq" && (
            <ul className="mt-3 space-y-1 text-[15px] text-ink-2">
              {card.options.map((o, i) => (
                <li key={o}>
                  {String.fromCharCode(65 + i)}. {o}
                </li>
              ))}
            </ul>
          )}
          <div className="mt-auto pt-6">
            {revealed ? (
              <div className="rounded-md border border-ok/25 bg-ok-soft px-4 py-3">
                <p className="text-sm font-semibold text-ok">Answer: {card.answer}</p>
                {card.explanation && <p className="mt-1 text-sm text-ink-2">{card.explanation}</p>}
              </div>
            ) : (
              <Button variant="primary" icon={<Eye className="size-4" />} onClick={() => setRevealed(true)}>
                Show answer
              </Button>
            )}
          </div>
        </Panel>
      )}
      {card && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Button icon={<ArrowLeft className="size-4" />} disabled={index === 0} onClick={() => go(-1)}>
            Previous
          </Button>
          <Button
            variant={quiz.marked.includes(card.id) ? "primary" : "secondary"}
            icon={quiz.marked.includes(card.id) ? <BookmarkCheck className="size-4" /> : <Bookmark className="size-4" />}
            onClick={() => void onMark(card.id, !quiz.marked.includes(card.id))}
          >
            {quiz.marked.includes(card.id) ? "Marked for review" : "Mark for review"}
          </Button>
          <Button disabled={index >= cards.length - 1} onClick={() => go(1)}>
            Next <ArrowRight className="size-4" />
          </Button>
        </div>
      )}
    </div>
  );
}

export default function QuizPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const toast = useToast();
  const quiz = useApi<QuizDetail>(`/api/quizzes/${id}`);
  const [mode, setMode] = useState<"quiz" | "cards">("quiz");
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [jobId, setJobId] = useState<string | null>(null);
  const [error, setError] = useState<{ message: string; fix?: string } | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const { job, cancel } = useJob<{ attemptId: number }>(jobId, (finished) => {
    setJobId(null);
    if (finished.status === "done" && finished.result) router.push(`/quizzes/attempts/${finished.result.attemptId}`);
    else if (finished.status === "cancelled") setError({ message: "Grading was stopped. Your answers are still filled in; submit again when ready." });
    else setError(finished.error ?? { message: "Grading failed." });
  });
  useJobActivity(job);

  const q = quiz.data;
  const answered = useMemo(() => (q ? q.questions.filter((x) => answers[x.id]?.trim()).length : 0), [q, answers]);

  async function submit() {
    setError(null);
    setSubmitting(true);
    try {
      const started = await api<{ id: string }>(`/api/quizzes/${id}/attempts`, { method: "POST", json: { answers } });
      setJobId(started.id);
    } catch (e) {
      const err = e instanceof ApiError ? e : new ApiError("unknown", String(e));
      setError({ message: err.message, fix: err.fix });
    } finally {
      setSubmitting(false);
    }
  }

  async function mark(questionId: string, marked: boolean) {
    try {
      await api(`/api/quizzes/${id}/marks`, { method: "POST", json: { questionId, marked } });
      void quiz.reload();
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), "bad");
    }
  }

  if (quiz.loading && !q) {
    return (
      <PageContainer>
        <div className="flex items-center gap-2 text-ink-2">
          <Spinner /> Loading quiz…
        </div>
      </PageContainer>
    );
  }
  if (quiz.error || !q) {
    return (
      <PageContainer>
        <ErrorNotice error={quiz.error ?? { message: "Quiz not found." }} />
      </PageContainer>
    );
  }

  const hasShort = q.questions.some((x) => x.type === "short");
  const firstDoc = q.documentIds[0];

  return (
    <PageContainer>
      <Link href="/quizzes" className="mb-4 inline-flex items-center gap-1 text-[13px] font-medium text-ink-2 hover:text-ink">
        <ArrowLeft className="size-4" /> Practice quizzes
      </Link>
      <header className="mb-5 flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-[26px] font-semibold leading-tight">{q.title}</h1>
          <p className="mt-1.5 text-[13px] text-ink-2">
            {q.questions.length} questions, {q.difficulty} difficulty{q.model ? `, written by ${q.model}` : ""}, {formatDate(q.createdAt)}
          </p>
        </div>
        <Segmented
          label="Mode"
          value={mode}
          onChange={setMode}
          options={[
            { value: "quiz", label: "Take quiz" },
            { value: "cards", label: "Flashcards" },
          ]}
        />
      </header>

      {(q.meta?.removed ?? 0) > 0 && (
        <p className="mb-4 rounded-md border border-rule bg-surface px-4 py-2.5 text-[13px] text-ink-2">
          The model produced {q.meta!.removed} question{q.meta!.removed! > 1 ? "s" : ""} that failed validation (for example an answer that wasn&apos;t one of the options); {q.meta!.removed! > 1 ? "they were" : "it was"} removed.
          {q.meta?.requested && q.meta.generated !== undefined && q.meta.generated < q.meta.requested ? ` You asked for ${q.meta.requested}; ${q.meta.generated} are usable.` : ""}
        </p>
      )}
      {q.meta?.grounding === "general" && (
        <p className="mb-4 rounded-md border border-rule bg-surface px-4 py-2.5 text-[13px] text-ink-2">These questions come from the model&apos;s general knowledge, not from your materials.</p>
      )}

      {mode === "cards" ? (
        <Flashcards quiz={q} onMark={mark} />
      ) : (
        <div className="space-y-4">
          <ol className="space-y-4">
            {q.questions.map((question, i) => (
              <li key={question.id}>
                <Panel className="p-5">
                  <div className="mb-3 flex items-baseline gap-3">
                    <span className="text-sm font-semibold tabular-nums text-ink-3">{i + 1}</span>
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-medium text-ink-3">{TYPE_LABEL[question.type]}</p>
                      <p className="mt-1 font-[family-name:var(--font-reading)] text-[17px] leading-relaxed text-ink">{question.question}</p>
                    </div>
                  </div>
                  <div className="sm:pl-7">
                    <QuestionInput q={question} value={answers[question.id] ?? ""} onChange={(v) => setAnswers((a) => ({ ...a, [question.id]: v }))} />
                  </div>
                </Panel>
              </li>
            ))}
          </ol>

          <div className="sticky bottom-0 -mx-4 border-t border-rule bg-paper/95 px-4 py-3 backdrop-blur sm:mx-0 sm:rounded-lg sm:border sm:bg-surface">
            {jobId ? (
              <JobProgress job={job} onCancel={() => void cancel()} label="Checking your answers" />
            ) : (
              <div className="flex flex-wrap items-center justify-between gap-3">
                <span className="text-sm text-ink-2">
                  {answered} of {q.questions.length} answered
                  {hasShort && ". Short answers are checked by your local model."}
                </span>
                <Button variant="primary" busy={submitting} disabled={answered === 0} onClick={() => void submit()}>
                  Submit answers
                </Button>
              </div>
            )}
            {error && (
              <div className="mt-3">
                <ErrorNotice error={error} compact />
              </div>
            )}
          </div>
        </div>
      )}

      <Panel className="mt-8">
        <PanelHeader
          title="Previous attempts"
          action={
            firstDoc ? (
              <Link href={`/quizzes?doc=${firstDoc}`}>
                <Button size="sm" icon={<RotateCcw className="size-3.5" />}>
                  New quiz on this material
                </Button>
              </Link>
            ) : undefined
          }
        />
        {q.attempts.length === 0 ? (
          <p className="px-4 py-4 text-sm text-ink-2">No attempts yet.</p>
        ) : (
          <ul className="divide-y divide-rule">
            {q.attempts.map((a) => {
              const pct = a.maxScore ? Math.round((a.score / a.maxScore) * 100) : 0;
              return (
                <li key={a.id}>
                  <Link href={`/quizzes/attempts/${a.id}`} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm hover:bg-surface-2">
                    <span className="text-ink">
                      {a.score} of {a.maxScore} points{a.ungraded ? `, ${a.ungraded} not graded` : ""}
                    </span>
                    <span className="flex items-center gap-3">
                      <Badge tone={pct >= 70 ? "ok" : pct >= 50 ? "warn" : "bad"}>{pct}%</Badge>
                      <span className="text-xs text-ink-3">{formatDate(a.createdAt)}</span>
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </Panel>
    </PageContainer>
  );
}
