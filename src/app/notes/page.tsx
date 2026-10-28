"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useMemo, useState } from "react";
import { NotebookPen, Search, Trash2 } from "lucide-react";
import { Markdown } from "@/components/Markdown";
import { AIReadiness, JobProgress, useJobActivity } from "@/components/shared";
import { PageContainer } from "@/components/shell/AppShell";
import { useAIStatus, useToast } from "@/components/shell/providers";
import { Badge, Button, ConfirmDialog, EmptyState, ErrorNotice, Field, IconButton, Input, PageHeader, Panel, PanelHeader, Select, Spinner, cx, formatDate } from "@/components/ui";
import { api, ApiError, useApi, useJob } from "@/hooks/api";
import { KINDS, kindLabel } from "@/components/notes-kinds";
import type { DocumentSummary, LanguagePref, NoteKind, NoteSummary } from "@/lib/types";

function NotesInner() {
  const router = useRouter();
  const params = useSearchParams();
  const toast = useToast();
  const { status } = useAIStatus();
  const docs = useApi<DocumentSummary[]>("/api/documents");
  const notes = useApi<NoteSummary[]>("/api/notes");
  const [docId, setDocId] = useState<string>(params.get("doc") ?? "");
  const [kind, setKind] = useState<NoteKind>("detailed");
  const [language, setLanguage] = useState<LanguagePref>("auto");
  const [query, setQuery] = useState("");
  const [jobId, setJobId] = useState<string | null>(null);
  const [error, setError] = useState<{ message: string; fix?: string } | null>(null);
  const [starting, setStarting] = useState(false);
  const [deleting, setDeleting] = useState<NoteSummary | null>(null);

  const { job, cancel } = useJob<{ noteId: number }>(jobId, (finished) => {
    setJobId(null);
    if (finished.status === "done" && finished.result) {
      toast("Notes saved.");
      router.push(`/notes/${finished.result.noteId}`);
    } else if (finished.status === "cancelled") {
      setError({ message: "Stopped. Nothing was saved." });
    } else {
      setError(finished.error ?? { message: "Summarizing failed." });
    }
  });
  useJobActivity(job);

  const usable = (docs.data ?? []).filter((d) => d.searchable);
  const selected = usable.find((d) => String(d.id) === docId);

  async function generate() {
    setError(null);
    setStarting(true);
    try {
      const started = await api<{ id: string }>("/api/notes", { method: "POST", json: { documentId: Number(docId), kind, language } });
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
      await api(`/api/notes/${deleting.id}`, { method: "DELETE" });
      toast("Note deleted.");
      setDeleting(null);
      void notes.reload();
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), "bad");
    }
  }

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (notes.data ?? []).filter((n) => !q || n.title.toLowerCase().includes(q) || n.preview.toLowerCase().includes(q));
  }, [notes.data, query]);

  return (
    <PageContainer wide>
      <PageHeader title="Summaries & notes" description="Turn a lecture into study notes with your local model. Notes are saved automatically and point back to the pages they came from." />

      <div className="grid gap-6 lg:grid-cols-[420px_1fr]">
        <Panel className="self-start">
          <PanelHeader title="Create notes" />
          <div className="space-y-4 p-4">
            <AIReadiness status={status} compact />
            <Field label="Material" htmlFor="note-doc">
              <Select id="note-doc" value={docId} onChange={(e) => setDocId(e.target.value)}>
                <option value="">Choose a material…</option>
                {usable.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.title}
                    {d.courseName ? ` (${d.courseName})` : ""}
                  </option>
                ))}
              </Select>
            </Field>
            {docs.data && usable.length === 0 && (
              <p className="text-[13px] text-ink-2">
                No materials yet.{" "}
                <Link href="/materials" className="font-medium text-action hover:underline">
                  Upload one first
                </Link>
                .
              </p>
            )}
            <fieldset>
              <legend className="mb-1.5 text-[13px] font-medium text-ink-2">Type of notes</legend>
              <div className="space-y-1.5">
                {KINDS.map((k) => (
                  <label
                    key={k.value}
                    className={cx("flex cursor-pointer gap-2.5 rounded-md border px-3 py-2", kind === k.value ? "border-action bg-action-soft" : "border-rule hover:border-rule-strong")}
                  >
                    <input type="radio" name="kind" className="mt-1 accent-[var(--action)]" checked={kind === k.value} onChange={() => setKind(k.value)} />
                    <span>
                      <span className="block text-sm font-medium text-ink">{k.label}</span>
                      <span className="block text-xs text-ink-2">{k.text}</span>
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
            <Field label="Language" htmlFor="note-lang">
              <Select id="note-lang" value={language} onChange={(e) => setLanguage(e.target.value as LanguagePref)}>
                <option value="auto">Same as the material</option>
                <option value="en">English</option>
                <option value="th">ภาษาไทย (Thai)</option>
              </Select>
            </Field>
            {selected && (
              <p className="text-xs text-ink-3">
                {selected.wordCount > 2500
                  ? `This material is long (${selected.wordCount.toLocaleString()} words), so it will be summarized in parts and then combined. That takes several model calls.`
                  : `${selected.wordCount.toLocaleString()} words.`}
              </p>
            )}
            <ErrorNotice error={error} compact />
            <Button variant="primary" className="w-full" icon={<NotebookPen className="size-4" />} busy={starting} disabled={!docId || Boolean(jobId)} onClick={() => void generate()}>
              Generate notes
            </Button>
          </div>
        </Panel>

        <div className="min-w-0 space-y-6">
          {jobId && (
            <Panel>
              <PanelHeader title={selected ? `${kindLabel(kind)}: ${selected.title}` : "Generating notes"} description={`Written by ${status?.chat.model ?? "your local model"}`} />
              <div className="space-y-4 p-4">
                <JobProgress job={job} onCancel={() => void cancel()} />
                {job?.partial && (
                  <div className="max-h-[420px] overflow-y-auto rounded-md border border-rule bg-surface-2 p-4">
                    <Markdown streaming>{job.partial}</Markdown>
                  </div>
                )}
              </div>
            </Panel>
          )}

          <Panel>
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-rule px-4 py-3">
              <h2 className="text-[15px] font-semibold">Saved notes</h2>
              <div className="relative w-full sm:w-64">
                <Search className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-ink-3" aria-hidden />
                <Input className="pl-8" placeholder="Search notes" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search notes" />
              </div>
            </div>
            {notes.loading && !notes.data ? (
              <div className="flex items-center gap-2 p-4 text-sm text-ink-2">
                <Spinner /> Loading…
              </div>
            ) : visible.length === 0 ? (
              <EmptyState icon={<NotebookPen className="size-7" />} title={query ? "No notes match your search" : "No notes yet"}>
                {query ? "Try a different word." : "Choose a material and generate your first notes."}
              </EmptyState>
            ) : (
              <ul className="divide-y divide-rule">
                {visible.map((n) => (
                  <li key={n.id} className="group flex items-start gap-3 px-4 py-3 hover:bg-surface-2">
                    <Link href={`/notes/${n.id}`} className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="truncate text-sm font-medium text-ink group-hover:text-action">{n.title}</span>
                        <Badge>{kindLabel(n.kind)}</Badge>
                      </span>
                      <span className="mt-0.5 line-clamp-2 block text-[13px] text-ink-2">{n.preview}</span>
                      <span className="mt-1 block text-xs text-ink-3">
                        {n.documentTitle ?? "Material deleted"}, {formatDate(n.updatedAt)}
                      </span>
                    </Link>
                    <IconButton label={`Delete ${n.title}`} onClick={() => setDeleting(n)}>
                      <Trash2 className="size-4" />
                    </IconButton>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>
      </div>

      <ConfirmDialog
        open={deleting !== null}
        title="Delete this note?"
        body={<>“{deleting?.title}” will be deleted from this computer.</>}
        confirmLabel="Delete note"
        onConfirm={() => void confirmDelete()}
        onClose={() => setDeleting(null)}
      />
    </PageContainer>
  );
}

export default function NotesPage() {
  return (
    <Suspense fallback={null}>
      <NotesInner />
    </Suspense>
  );
}
