"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { ArrowLeft, CheckCircle2, CircleHelp, CircleMinus, RotateCcw, XCircle } from "lucide-react";
import { PageContainer } from "@/components/shell/AppShell";
import { Badge, Button, ErrorNotice, Panel, Segmented, Spinner, cx, formatDate } from "@/components/ui";
import { useApi } from "@/hooks/api";
import type { AttemptDetail, QuestionResult } from "@/lib/types";

function Verdict({ r }: { r: QuestionResult }) {
  if (r.verdict === "correct") return <Badge tone="ok"><CheckCircle2 className="size-3.5" /> Correct</Badge>;
  if (r.verdict === "partial") return <Badge tone="warn"><CircleMinus className="size-3.5" /> Partly correct</Badge>;
  if (r.verdict === "ungraded") return <Badge><CircleHelp className="size-3.5" /> Not graded</Badge>;
  return <Badge tone="bad"><XCircle className="size-3.5" /> Incorrect</Badge>;
}

export default function AttemptPage() {
  const { id } = useParams<{ id: string }>();
  const attempt = useApi<AttemptDetail>(`/api/attempts/${id}`);
  const [filter, setFilter] = useState<"all" | "wrong">("all");

  const a = attempt.data;
  if (attempt.loading && !a) {
    return (
      <PageContainer>
        <div className="flex items-center gap-2 text-ink-2">
          <Spinner /> Loading results…
        </div>
      </PageContainer>
    );
  }
  if (attempt.error || !a) {
    return (
      <PageContainer>
        <ErrorNotice error={attempt.error ?? { message: "Attempt not found." }} />
      </PageContainer>
    );
  }

  const pct = a.maxScore ? Math.round((a.score / a.maxScore) * 100) : 0;
  const byId = new Map(a.results.map((r) => [r.questionId, r]));
  const shown = a.questions.filter((q) => filter === "all" || byId.get(q.id)?.verdict !== "correct");
  const wrong = a.results.filter((r) => r.verdict !== "correct").length;

  return (
    <PageContainer>
      <Link href={`/quizzes/${a.quizId}`} className="mb-4 inline-flex items-center gap-1 text-[13px] font-medium text-ink-2 hover:text-ink">
        <ArrowLeft className="size-4" /> {a.quizTitle}
      </Link>

      <Panel className="mb-6 flex flex-wrap items-center gap-6 px-6 py-5">
        <div>
          <p className="text-[13px] text-ink-2">Your score</p>
          <p className="text-[40px] font-semibold leading-none tabular-nums">
            {pct}
            <span className="text-2xl text-ink-3">%</span>
          </p>
        </div>
        <div className="min-w-[200px] flex-1">
          <div className="h-2 overflow-hidden rounded-full bg-black/[0.06]">
            <div className={cx("h-full rounded-full", pct >= 70 ? "bg-ok" : pct >= 50 ? "bg-[#d99a17]" : "bg-bad")} style={{ width: `${pct}%` }} />
          </div>
          <p className="mt-2 text-sm text-ink-2">
            {a.score} of {a.maxScore} points, {formatDate(a.createdAt)}
            {a.ungraded > 0 && `. ${a.ungraded} short answer${a.ungraded > 1 ? "s" : ""} couldn't be graded and ${a.ungraded > 1 ? "aren't" : "isn't"} counted.`}
          </p>
        </div>
        <div className="flex gap-2">
          <Link href={`/quizzes/${a.quizId}`}>
            <Button icon={<RotateCcw className="size-4" />}>Retry quiz</Button>
          </Link>
          <Link href="/quizzes">
            <Button variant="primary">New quiz</Button>
          </Link>
        </div>
      </Panel>

      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">Review</h2>
        <Segmented
          label="Show"
          value={filter}
          onChange={setFilter}
          options={[
            { value: "all", label: `All (${a.questions.length})` },
            { value: "wrong", label: `To review (${wrong})` },
          ]}
        />
      </div>

      {shown.length === 0 && <Panel className="p-6 text-center text-sm text-ink-2">Everything was correct. Nothing to review.</Panel>}

      <ol className="space-y-4">
        {shown.map((q) => {
          const r = byId.get(q.id);
          const index = a.questions.indexOf(q);
          const source = a.sources.find((s) => s.label === q.source);
          return (
            <li key={q.id}>
              <Panel className="p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <p className="min-w-0 flex-1 font-[family-name:var(--font-reading)] text-[17px] leading-relaxed text-ink">
                    <span className="mr-2 font-sans text-sm font-semibold text-ink-3">{index + 1}</span>
                    {q.question}
                  </p>
                  {r && <Verdict r={r} />}
                </div>

                {q.type !== "short" ? (
                  <ul className="mt-3 space-y-1.5 text-[15px]">
                    {q.options.map((o, i) => {
                      const isAnswer = o === q.answer;
                      const isGiven = r?.given === o || (q.type === "tf" && r?.given?.toLowerCase() === o.toLowerCase());
                      return (
                        <li
                          key={o}
                          className={cx(
                            "flex items-start gap-2 rounded-md border px-3 py-2",
                            isAnswer ? "border-ok/40 bg-ok-soft" : isGiven ? "border-bad/40 bg-bad-soft" : "border-rule",
                          )}
                        >
                          <span className="w-5 font-semibold text-ink-3">{q.type === "mcq" ? String.fromCharCode(65 + i) : ""}</span>
                          <span className="flex-1">{o}</span>
                          {isAnswer && <span className="text-xs font-medium text-ok">Correct answer</span>}
                          {isGiven && !isAnswer && <span className="text-xs font-medium text-bad">Your answer</span>}
                          {isGiven && isAnswer && <span className="text-xs font-medium text-ok">Your answer</span>}
                        </li>
                      );
                    })}
                    {!r?.given && <li className="text-sm text-ink-3">You didn&apos;t answer this one.</li>}
                  </ul>
                ) : (
                  <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    <div className="rounded-md border border-rule px-3 py-2">
                      <p className="text-xs font-medium text-ink-3">Your answer</p>
                      <p className="mt-1 whitespace-pre-wrap text-[15px] text-ink">{r?.given || "No answer"}</p>
                    </div>
                    <div className="rounded-md border border-ok/30 bg-ok-soft px-3 py-2">
                      <p className="text-xs font-medium text-ok">Model answer</p>
                      <p className="mt-1 text-[15px] text-ink">{q.answer}</p>
                    </div>
                  </div>
                )}

                {r?.feedback && (
                  <div className="mt-3 rounded-md bg-surface-2 px-3 py-2 text-sm text-ink-2">
                    <span className="font-medium text-ink">{r.aiGraded ? "AI feedback (a suggestion, not a final grade): " : "Note: "}</span>
                    {r.feedback}
                  </div>
                )}
                {q.explanation && (
                  <p className="mt-3 text-sm text-ink-2">
                    <span className="font-medium text-ink">Why: </span>
                    {q.explanation}
                  </p>
                )}
                {source && (
                  <p className="mt-2 text-[13px] text-ink-3">
                    Source:{" "}
                    <Link href={`/materials/${source.documentId}#u-${source.unitStart}`} className="font-medium text-action hover:underline">
                      {source.documentTitle}, {source.location}
                    </Link>
                  </p>
                )}
              </Panel>
            </li>
          );
        })}
      </ol>
    </PageContainer>
  );
}
