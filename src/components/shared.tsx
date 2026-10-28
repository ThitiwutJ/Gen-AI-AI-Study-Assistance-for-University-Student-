"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { FileText, FileType2, Presentation, StickyNote, Square, SquareCheckBig, X } from "lucide-react";
import { useAIStatus } from "@/components/shell/providers";
import { Badge, Button, Dialog, Input, Select, Spinner, cx, renderInlineCode } from "@/components/ui";
import type { AIStatus, ContextScope, Course, DocumentSummary, JobView } from "@/lib/types";

// ---------- Job progress ----------

function stageText(job: JobView): string {
  const s = job.stage;
  if (s === "starting") return "Starting…";
  if (s === "searching") return "Searching your materials…";
  if (s === "loading_model") return "Loading the model into memory — the first request after a while can take a minute…";
  if (s === "waiting") return "Waiting for the model to start writing…";
  if (s === "generating") return job.tokens ? `Writing… ${job.tokens} tokens so far` : "Writing…";
  if (s === "combining") return "Combining the partial notes into the final summary…";
  if (s === "condensing notes") return "Condensing the partial notes…";
  return `Working on ${s}…`;
}

export function JobProgress({ job, onCancel, label }: { job: JobView | null; onCancel?: () => void; label?: string }) {
  if (!job || job.status !== "running") return null;
  const pct = job.progress && job.progress.total ? Math.round((job.progress.done / job.progress.total) * 100) : null;
  return (
    <div className="rounded-md border border-rule bg-surface px-4 py-3" role="status" aria-live="polite">
      <div className="flex items-center gap-3">
        <Spinner className="text-action" />
        <div className="min-w-0 flex-1">
          {label && <p className="text-sm font-medium text-ink">{label}</p>}
          <p className="text-[13px] text-ink-2">{stageText(job)}</p>
        </div>
        {onCancel && (
          <Button size="sm" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        )}
      </div>
      {pct !== null && (
        <div className="mt-3 flex items-center gap-3">
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-black/[0.06]">
            <div className="h-full rounded-full bg-action transition-[width] duration-500" style={{ width: `${pct}%` }} />
          </div>
          <span className="w-20 text-right text-xs tabular-nums text-ink-3">
            {job.progress!.done} of {job.progress!.total}
          </span>
        </div>
      )}
    </div>
  );
}

/** Mirror a running job into the global AI status pill. */
export function useJobActivity(job: JobView | null) {
  const { setActivity } = useAIStatus();
  const stage = job?.status === "running" ? job.stage : null;
  useEffect(() => {
    if (!stage) {
      setActivity(null);
      return;
    }
    setActivity(stage === "loading_model" ? "loading_model" : stage === "searching" || stage === "starting" ? null : "generating");
  }, [stage, setActivity]);
  useEffect(() => () => setActivity(null), [setActivity]);
}

// ---------- AI readiness banner ----------

export function AIReadiness({ status, compact }: { status: AIStatus | null; compact?: boolean }) {
  if (!status || status.state === "connected") return null;
  const problem = status.problems[0];
  return (
    <div className={cx("rounded-md border border-warn/30 bg-warn-soft text-sm", compact ? "px-3 py-2.5" : "px-4 py-3")} role="alert">
      <p className="font-medium text-ink">{problem?.message ?? "The local AI isn't ready."}</p>
      {problem?.fix && <p className="mt-0.5 text-ink-2">{renderInlineCode(problem.fix)}</p>}
      <p className="mt-1.5 text-[13px] text-ink-2">
        Your saved materials, notes and quizzes are still available.{" "}
        <Link href="/settings" className="font-medium text-action underline underline-offset-2">
          Open AI settings
        </Link>
      </p>
    </div>
  );
}

// ---------- Documents ----------

export function DocIcon({ type, className }: { type: string; className?: string }) {
  const cls = cx("size-4 shrink-0", className);
  if (type === "pdf") return <FileType2 className={cx(cls, "text-[#b3412e]")} aria-label="PDF" />;
  if (type === "pptx") return <Presentation className={cx(cls, "text-[#b5651d]")} aria-label="PowerPoint" />;
  if (type === "docx") return <FileText className={cx(cls, "text-action")} aria-label="Word" />;
  return <StickyNote className={cx(cls, "text-ink-3")} aria-label="Text" />;
}

export function IndexBadge({ doc }: { doc: DocumentSummary }) {
  switch (doc.indexStatus) {
    case "ready":
      return <Badge tone="ok">Indexed</Badge>;
    case "indexing":
      return (
        <Badge tone="action">
          Indexing {doc.indexedChunks} of {doc.chunkCount}
        </Badge>
      );
    case "pending":
      return <Badge tone="neutral">Waiting to index</Badge>;
    case "keyword_only":
      return <Badge tone="neutral">Keyword search</Badge>;
    case "stale":
      return <Badge tone="warn">Re-index needed</Badge>;
    case "failed":
      return <Badge tone="bad">Indexing failed</Badge>;
    case "skipped":
      return <Badge tone="warn">Text unreadable</Badge>;
  }
}

export function unitWord(kind: string, n: number): string {
  const w = kind === "page" ? "page" : kind === "slide" ? "slide" : "section";
  return `${n} ${w}${n === 1 ? "" : "s"}`;
}

// ---------- Context (which materials the AI may use) ----------

export interface ScopeValue {
  scope: ContextScope;
  courseId: number | null;
  documentIds: number[];
}

export function describeScope(v: ScopeValue, courses: Course[], docs: DocumentSummary[]): string {
  if (v.scope === "none") return "No materials (general knowledge)";
  if (v.scope === "course") return `Course: ${courses.find((c) => c.id === v.courseId)?.name ?? "—"}`;
  if (v.scope === "documents") {
    if (v.documentIds.length === 1) return docs.find((d) => d.id === v.documentIds[0])?.title ?? "1 material";
    return `${v.documentIds.length} materials`;
  }
  return "All my materials";
}

export function ScopePicker({
  value,
  onChange,
  courses,
  documents,
  allowNone = true,
  allowAll = true,
  title = "Which materials should the AI use?",
}: {
  value: ScopeValue;
  onChange: (v: ScopeValue) => void;
  courses: Course[];
  documents: DocumentSummary[];
  allowNone?: boolean;
  allowAll?: boolean;
  title?: string;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<ScopeValue>(value);
  const [filter, setFilter] = useState("");

  const visibleDocs = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return documents.filter((d) => !q || d.title.toLowerCase().includes(q) || d.courseName?.toLowerCase().includes(q));
  }, [documents, filter]);

  const options: { value: ContextScope; label: string; hint: string }[] = [
    ...(allowAll ? [{ value: "all" as const, label: "All my materials", hint: "Search everything you've uploaded." }] : []),
    { value: "course", label: "One course", hint: "Only materials in a course." },
    { value: "documents", label: "Specific materials", hint: "Pick one or more documents." },
    ...(allowNone ? [{ value: "none" as const, label: "No materials", hint: "Answer from the model's general knowledge only." }] : []),
  ];

  const valid = draft.scope !== "course" || draft.courseId !== null ? draft.scope !== "documents" || draft.documentIds.length > 0 : false;

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setDraft(value);
          setOpen(true);
        }}
        className="inline-flex h-8 max-w-full items-center gap-2 rounded-md border border-rule-strong bg-surface px-2.5 text-[13px] text-ink hover:bg-surface-2"
      >
        <FileText className="size-3.5 shrink-0 text-ink-3" aria-hidden />
        <span className="truncate">{describeScope(value, courses, documents)}</span>
      </button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title={title}
        wide
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              disabled={!valid}
              onClick={() => {
                onChange(draft);
                setOpen(false);
              }}
            >
              Use these materials
            </Button>
          </>
        }
      >
        <div className="grid gap-2 sm:grid-cols-2">
          {options.map((o) => (
            <label
              key={o.value}
              className={cx(
                "flex cursor-pointer gap-2.5 rounded-md border px-3 py-2.5",
                draft.scope === o.value ? "border-action bg-action-soft" : "border-rule hover:border-rule-strong",
              )}
            >
              <input type="radio" name="scope" className="mt-1 accent-[var(--action)]" checked={draft.scope === o.value} onChange={() => setDraft({ ...draft, scope: o.value })} />
              <span>
                <span className="block text-sm font-medium text-ink">{o.label}</span>
                <span className="block text-xs text-ink-2">{o.hint}</span>
              </span>
            </label>
          ))}
        </div>

        {draft.scope === "course" && (
          <div className="mt-4">
            {courses.length ? (
              <Select aria-label="Course" value={draft.courseId ?? ""} onChange={(e) => setDraft({ ...draft, courseId: e.target.value ? Number(e.target.value) : null })}>
                <option value="">Choose a course…</option>
                {courses.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} ({c.documentCount})
                  </option>
                ))}
              </Select>
            ) : (
              <p className="text-sm text-ink-2">You haven&apos;t created any courses yet. Create one in Study Materials.</p>
            )}
          </div>
        )}

        {draft.scope === "documents" && (
          <div className="mt-4 space-y-2">
            <Input placeholder="Filter materials…" value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Filter materials" />
            <div className="max-h-72 overflow-y-auto rounded-md border border-rule">
              {visibleDocs.length === 0 && <p className="p-4 text-sm text-ink-2">No materials match. Upload some in Study Materials.</p>}
              {visibleDocs.map((d) => {
                const checked = draft.documentIds.includes(d.id);
                return (
                  <button
                    type="button"
                    key={d.id}
                    disabled={!d.searchable}
                    onClick={() =>
                      setDraft({ ...draft, documentIds: checked ? draft.documentIds.filter((x) => x !== d.id) : [...draft.documentIds, d.id] })
                    }
                    className="flex w-full items-center gap-2.5 border-b border-rule px-3 py-2 text-left last:border-0 hover:bg-surface-2 disabled:opacity-50"
                  >
                    {checked ? <SquareCheckBig className="size-4 text-action" /> : <Square className="size-4 text-ink-3" />}
                    <DocIcon type={d.fileType} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm text-ink">{d.title}</span>
                      <span className="block truncate text-xs text-ink-3">
                        {d.courseName ?? "No course"} · {unitWord(d.unitKind, d.unitCount)}
                        {!d.searchable && " · text unreadable"}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
            {draft.documentIds.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {draft.documentIds.map((id) => (
                  <span key={id} className="inline-flex items-center gap-1 rounded bg-action-soft px-2 py-0.5 text-xs text-action">
                    {documents.find((d) => d.id === id)?.title ?? id}
                    <button aria-label="Remove" onClick={() => setDraft({ ...draft, documentIds: draft.documentIds.filter((x) => x !== id) })}>
                      <X className="size-3" />
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>
        )}
      </Dialog>
    </>
  );
}
