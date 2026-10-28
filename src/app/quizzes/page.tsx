"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { ListChecks, Trash2 } from "lucide-react";
import { AIReadiness, JobProgress, ScopePicker, useJobActivity, type ScopeValue } from "@/components/shared";
import { PageContainer } from "@/components/shell/AppShell";
import { useAIStatus, useToast } from "@/components/shell/providers";
import { Badge, Button, ConfirmDialog, EmptyState, ErrorNotice, Field, IconButton, Input, PageHeader, Panel, PanelHeader, Segmented, Select, Spinner, formatDate } from "@/components/ui";
import { api, ApiError, useApi, useJob } from "@/hooks/api";
import type { Course, Difficulty, DocumentSummary, LanguagePref, QuestionType, QuizSummary } from "@/lib/types";

const TYPE_LABELS: Record<QuestionType, string> = { mcq: "Multiple choice", tf: "True / false", short: "Short answer" };

function QuizzesInner() {
  const router = useRouter();
  const params = useSearchParams();
  const toast = useToast();
  const { status } = useAIStatus();
  const quizzes = useApi<QuizSummary[]>("/api/quizzes");
  const courses = useApi<Course[]>("/api/courses");
  const docs = useApi<DocumentSummary[]>("/api/documents");

  const docParam = params.get("doc");
  const [source, setSource] = useState<"materials" | "topic">("materials");
  const [scope, setScope] = useState<ScopeValue>({ scope: "documents", courseId: null, documentIds: docParam ? [Number(docParam)] : [] });
  const [topic, setTopic] = useState("");
  const [count, setCount] = useState<"3" | "5" | "10">("5");
  const [difficulty, setDifficulty] = useState<Difficulty>("medium");
  const [types, setTypes] = useState<QuestionType[]>(["mcq", "tf"]);
  const [language, setLanguage] = useState<LanguagePref>("auto");
  const [jobId, setJobId] = useState<string | null>(null);
  const [error, setError] = useState<{ message: string; fix?: string } | null>(null);
  const [starting, setStarting] = useState(false);
  const [deleting, setDeleting] = useState<QuizSummary | null>(null);

  const { job, cancel } = useJob<{ quizId: number }>(jobId, (finished) => {
    setJobId(null);
    if (finished.status === "done" && finished.result) {
      router.push(`/quizzes/${finished.result.quizId}`);
    } else if (finished.status === "cancelled") {
      setError({ message: "Stopped. No quiz was created." });
    } else {
      setError(finished.error ?? { message: "Quiz generation failed." });
    }
  });
  useJobActivity(job);

  const scopeReady = source === "topic" ? topic.trim().length > 1 : scope.scope === "course" ? Boolean(scope.courseId) : scope.documentIds.length > 0;

  async function generate() {
    setError(null);
    setStarting(true);
    try {
      const body =
        source === "topic"
          ? { scope: "topic", topic, count: Number(count), difficulty, types, language }
          : {
              scope: scope.scope === "course" ? "course" : "documents",
              courseId: scope.courseId,
              documentIds: scope.documentIds,
              topic: topic.trim() || null,
              count: Number(count),
              difficulty,
              types,
              language,
            };
      const started = await api<{ id: string }>("/api/quizzes", { method: "POST", json: body });
      setJobId(started.id);
    } catch (e) {
      const err = e instanceof ApiError ? e : new ApiError("unknown", String(e));
      setError({ message: err.message, fix: err.fix });
    } finally {
      setStarting(false);
    }
  }

  async function confirmDelete() {
    if (!deleting) return;
    try {
      await api(`/api/quizzes/${deleting.id}`, { method: "DELETE" });
      toast("Quiz deleted.");
      setDeleting(null);
      void quizzes.reload();
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), "bad");
    }
  }

  return (
    <PageContainer wide>
      <PageHeader title="Practice quizzes" description="Generate questions from your materials, answer them, and learn from the feedback. Scores are saved from your real answers." />

      <div className="grid gap-6 lg:grid-cols-[420px_1fr]">
        <Panel className="self-start">
          <PanelHeader title="New quiz" />
          <div className="space-y-4 p-4">
            <AIReadiness status={status} compact />
            <Field label="Questions from">
              <Segmented
                label="Questions from"
                value={source}
                onChange={setSource}
                options={[
                  { value: "materials", label: "My materials" },
                  { value: "topic", label: "A topic" },
                ]}
              />
            </Field>
            {source === "materials" ? (
              <>
                <div>
                  <ScopePicker
                    value={scope.scope === "documents" || scope.scope === "course" ? scope : { scope: "documents", courseId: null, documentIds: [] }}
                    onChange={setScope}
                    courses={courses.data ?? []}
                    documents={docs.data ?? []}
                    allowNone={false}
                    allowAll={false}
                    title="Make questions from…"
                  />
                  {!scopeReady && <p className="mt-1.5 text-xs text-ink-3">Choose one or more materials, or a course.</p>}
                </div>
                <Field label="Focus on (optional)" htmlFor="quiz-focus" hint="Leave empty to cover the whole material.">
                  <Input id="quiz-focus" placeholder="e.g. compound interest" value={topic} onChange={(e) => setTopic(e.target.value)} />
                </Field>
              </>
            ) : (
              <Field label="Topic" htmlFor="quiz-topic" hint="Questions will use the model's general knowledge, not your materials.">
                <Input id="quiz-topic" placeholder="e.g. Supply and demand" value={topic} onChange={(e) => setTopic(e.target.value)} />
              </Field>
            )}
            <div className="grid grid-cols-2 gap-3">
              <Field label="Questions">
                <Segmented
                  label="Number of questions"
                  value={count}
                  onChange={setCount}
                  options={[
                    { value: "3", label: "3" },
                    { value: "5", label: "5" },
                    { value: "10", label: "10" },
                  ]}
                />
              </Field>
              <Field label="Language" htmlFor="quiz-lang">
                <Select id="quiz-lang" value={language} onChange={(e) => setLanguage(e.target.value as LanguagePref)}>
                  <option value="auto">Same as material</option>
                  <option value="en">English</option>
                  <option value="th">ภาษาไทย</option>
                </Select>
              </Field>
            </div>
            <Field label="Difficulty">
              <Segmented
                label="Difficulty"
                value={difficulty}
                onChange={setDifficulty}
                options={[
                  { value: "easy", label: "Easy" },
                  { value: "medium", label: "Medium" },
                  { value: "hard", label: "Hard" },
                ]}
              />
            </Field>
            <fieldset>
              <legend className="mb-1.5 text-[13px] font-medium text-ink-2">Question types</legend>
              <div className="flex flex-wrap gap-x-4 gap-y-2">
                {(Object.keys(TYPE_LABELS) as QuestionType[]).map((t) => (
                  <label key={t} className="flex items-center gap-2 text-sm text-ink">
                    <input
                      type="checkbox"
                      className="accent-[var(--action)]"
                      checked={types.includes(t)}
                      onChange={(e) => setTypes(e.target.checked ? [...types, t] : types.filter((x) => x !== t))}
                    />
                    {TYPE_LABELS[t]}
                  </label>
                ))}
              </div>
            </fieldset>
            <ErrorNotice error={error} compact />
            {jobId ? (
              <JobProgress job={job} onCancel={() => void cancel()} label="Writing questions" />
            ) : (
              <Button variant="primary" className="w-full" icon={<ListChecks className="size-4" />} busy={starting} disabled={!scopeReady || !types.length} onClick={() => void generate()}>
                Generate quiz
              </Button>
            )}
          </div>
        </Panel>

        <Panel className="min-w-0 self-start">
          <PanelHeader title="Your quizzes" />
          {quizzes.loading && !quizzes.data ? (
            <div className="flex items-center gap-2 p-4 text-sm text-ink-2">
              <Spinner /> Loading…
            </div>
          ) : !quizzes.data?.length ? (
            <EmptyState icon={<ListChecks className="size-7" />} title="No quizzes yet">
              Generate one from a lecture to test yourself. Every attempt and score is saved.
            </EmptyState>
          ) : (
            <ul className="divide-y divide-rule">
              {quizzes.data.map((q) => {
                const pct = q.lastScore !== null && q.lastMaxScore ? Math.round((q.lastScore / q.lastMaxScore) * 100) : null;
                return (
                  <li key={q.id} className="group flex items-center gap-3 px-4 py-3 hover:bg-surface-2">
                    <Link href={`/quizzes/${q.id}`} className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-ink group-hover:text-action">{q.title}</span>
                      <span className="block text-xs text-ink-3">
                        {q.questionCount} questions, {q.difficulty}, {q.attemptCount ? `${q.attemptCount} attempt${q.attemptCount > 1 ? "s" : ""}` : "not taken yet"}, {formatDate(q.createdAt)}
                      </span>
                    </Link>
                    {pct !== null && <Badge tone={pct >= 70 ? "ok" : pct >= 50 ? "warn" : "bad"}>Last: {pct}%</Badge>}
                    <IconButton label={`Delete ${q.title}`} onClick={() => setDeleting(q)}>
                      <Trash2 className="size-4" />
                    </IconButton>
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>
      </div>

      <ConfirmDialog
        open={deleting !== null}
        title="Delete this quiz?"
        body={<>“{deleting?.title}” and all its attempts will be deleted from this computer.</>}
        confirmLabel="Delete quiz"
        onConfirm={() => void confirmDelete()}
        onClose={() => setDeleting(null)}
      />
    </PageContainer>
  );
}

export default function QuizzesPage() {
  return (
    <Suspense fallback={null}>
      <QuizzesInner />
    </Suspense>
  );
}
