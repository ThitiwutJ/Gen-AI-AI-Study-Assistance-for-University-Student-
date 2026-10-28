"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, ClipboardPaste, FolderPlus, Pencil, Search, Trash2, UploadCloud, XCircle } from "lucide-react";
import { DocIcon, IndexBadge, unitWord } from "@/components/shared";
import { PageContainer } from "@/components/shell/AppShell";
import { useToast } from "@/components/shell/providers";
import { Button, ConfirmDialog, Dialog, EmptyState, ErrorNotice, Field, IconButton, Input, PageHeader, Panel, Segmented, Select, Spinner, Textarea, cx, formatBytes, formatDate } from "@/components/ui";
import { api, ApiError, useApi } from "@/hooks/api";
import type { Course, DocumentSummary } from "@/lib/types";

const ACCEPT = ".pdf,.docx,.pptx,.txt,.md";

interface UploadItem {
  key: string;
  name: string;
  size: number;
  state: "queued" | "uploading" | "processing" | "done" | "error";
  progress: number;
  error?: { message: string; fix?: string };
  docId?: number;
}

function uploadFile(file: File, fields: Record<string, string>, onProgress: (pct: number) => void): Promise<DocumentSummary> {
  return new Promise((resolve, reject) => {
    const form = new FormData();
    form.append("file", file);
    for (const [k, v] of Object.entries(fields)) if (v) form.append(k, v);
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/documents");
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(Math.round((e.loaded / e.total) * 100));
    xhr.upload.onload = () => onProgress(100);
    xhr.onload = () => {
      let data: unknown = null;
      try {
        data = JSON.parse(xhr.responseText);
      } catch {
        /* ignore */
      }
      if (xhr.status >= 200 && xhr.status < 300) resolve(data as DocumentSummary);
      else {
        const err = (data as { error?: { code: string; message: string; fix?: string } })?.error;
        reject(new ApiError(err?.code ?? "upload_failed", err?.message ?? `Upload failed (${xhr.status}).`, err?.fix, xhr.status));
      }
    };
    xhr.onerror = () => reject(new ApiError("network", "The upload was interrupted. Check that Gen AI is still running."));
    xhr.send(form);
  });
}

function MaterialsInner() {
  const router = useRouter();
  const params = useSearchParams();
  const toast = useToast();
  const courseFilter = params.get("course") ? Number(params.get("course")) : null;

  const courses = useApi<Course[]>("/api/courses");
  const docs = useApi<DocumentSummary[]>("/api/documents");
  const [query, setQuery] = useState("");

  // Upload state
  const [mode, setMode] = useState<"file" | "paste">("file");
  const [targetCourse, setTargetCourse] = useState<string>(courseFilter ? String(courseFilter) : "");
  const [items, setItems] = useState<UploadItem[]>([]);
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const [paste, setPaste] = useState({ title: "", text: "" });
  const [pasting, setPasting] = useState(false);
  const [pasteError, setPasteError] = useState<ApiError | null>(null);

  // Course + document management
  const [newCourse, setNewCourse] = useState<{ open: boolean; name: string; error?: string }>({ open: false, name: "" });
  const [renameDoc, setRenameDoc] = useState<DocumentSummary | null>(null);
  const [renameValue, setRenameValue] = useState({ title: "", description: "", courseId: "" });
  const [deleteDoc, setDeleteDoc] = useState<DocumentSummary | null>(null);
  const [deleteCourse, setDeleteCourse] = useState<Course | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (courseFilter) setTargetCourse(String(courseFilter));
  }, [courseFilter]);

  // Poll while documents are being indexed so progress updates live.
  const indexing = docs.data?.some((d) => d.indexStatus === "indexing" || d.indexStatus === "pending");
  const reloadDocs = docs.reload;
  useEffect(() => {
    if (!indexing) return;
    const t = setInterval(() => void reloadDocs(), 2000);
    return () => clearInterval(t);
  }, [indexing, reloadDocs]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (docs.data ?? []).filter(
      (d) =>
        (courseFilter === null || d.courseId === courseFilter) &&
        (!q || d.title.toLowerCase().includes(q) || d.description?.toLowerCase().includes(q) || d.fileName?.toLowerCase().includes(q)),
    );
  }, [docs.data, query, courseFilter]);

  async function processQueue(files: File[]) {
    const queued: UploadItem[] = files.map((f, i) => ({ key: `${Date.now()}-${i}-${f.name}`, name: f.name, size: f.size, state: "queued", progress: 0 }));
    setItems((prev) => [...queued, ...prev].slice(0, 12));
    for (let i = 0; i < files.length; i++) {
      const key = queued[i].key;
      const update = (patch: Partial<UploadItem>) => setItems((prev) => prev.map((it) => (it.key === key ? { ...it, ...patch } : it)));
      update({ state: "uploading" });
      try {
        const doc = await uploadFile(files[i], { courseId: targetCourse }, (pct) => update({ progress: pct, state: pct >= 100 ? "processing" : "uploading" }));
        update({ state: "done", docId: doc.id });
        void docs.reload();
        void courses.reload();
      } catch (e) {
        const err = e instanceof ApiError ? e : new ApiError("unknown", String(e));
        update({ state: "error", error: { message: err.message, fix: err.fix } });
      }
    }
  }

  async function submitPaste() {
    setPasting(true);
    setPasteError(null);
    try {
      const doc = await api<DocumentSummary>("/api/documents", {
        method: "POST",
        json: { title: paste.title || undefined, pastedText: paste.text, courseId: targetCourse ? Number(targetCourse) : null },
      });
      setPaste({ title: "", text: "" });
      toast(`Saved “${doc.title}”.`);
      void docs.reload();
      void courses.reload();
    } catch (e) {
      setPasteError(e instanceof ApiError ? e : new ApiError("unknown", String(e)));
    } finally {
      setPasting(false);
    }
  }

  async function createCourse() {
    try {
      const c = await api<Course>("/api/courses", { method: "POST", json: { name: newCourse.name } });
      setNewCourse({ open: false, name: "" });
      await courses.reload();
      setTargetCourse(String(c.id));
      toast(`Created course “${c.name}”.`);
    } catch (e) {
      setNewCourse((s) => ({ ...s, error: e instanceof Error ? e.message : String(e) }));
    }
  }

  async function saveRename() {
    if (!renameDoc) return;
    setBusy(true);
    try {
      await api(`/api/documents/${renameDoc.id}`, {
        method: "PATCH",
        json: { title: renameValue.title, description: renameValue.description || null, courseId: renameValue.courseId ? Number(renameValue.courseId) : null },
      });
      setRenameDoc(null);
      toast("Material updated.");
      void docs.reload();
      void courses.reload();
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), "bad");
    } finally {
      setBusy(false);
    }
  }

  async function confirmDeleteDoc() {
    if (!deleteDoc) return;
    setBusy(true);
    try {
      await api(`/api/documents/${deleteDoc.id}`, { method: "DELETE" });
      toast(`Deleted “${deleteDoc.title}”.`);
      setDeleteDoc(null);
      void docs.reload();
      void courses.reload();
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), "bad");
    } finally {
      setBusy(false);
    }
  }

  async function confirmDeleteCourse() {
    if (!deleteCourse) return;
    setBusy(true);
    try {
      await api(`/api/courses/${deleteCourse.id}`, { method: "DELETE" });
      toast(`Deleted course “${deleteCourse.name}”. Its materials were kept.`);
      setDeleteCourse(null);
      if (courseFilter === deleteCourse.id) router.push("/materials");
      void courses.reload();
      void docs.reload();
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), "bad");
    } finally {
      setBusy(false);
    }
  }

  const courseList = courses.data ?? [];

  return (
    <PageContainer wide>
      <PageHeader
        title="Study materials"
        description="Upload lectures and notes. Text is extracted, split and indexed on this computer so the tutor can answer from your materials and cite the page."
      />

      <div className="grid gap-6 lg:grid-cols-[220px_1fr]">
        {/* Courses */}
        <aside aria-label="Courses" className="space-y-1">
          <p className="px-2 pb-1 text-[13px] font-medium text-ink-3">Courses</p>
          <Link
            href="/materials"
            className={cx("flex items-center justify-between rounded-md px-2 py-1.5 text-sm", courseFilter === null ? "bg-black/[0.06] font-medium text-ink" : "text-ink-2 hover:bg-black/[0.04]")}
          >
            All materials <span className="text-xs text-ink-3">{docs.data?.length ?? ""}</span>
          </Link>
          {courseList.map((c) => (
            <div key={c.id} className={cx("group flex items-center rounded-md", courseFilter === c.id ? "bg-black/[0.06]" : "hover:bg-black/[0.04]")}>
              <Link href={`/materials?course=${c.id}`} className={cx("flex min-w-0 flex-1 items-center justify-between px-2 py-1.5 text-sm", courseFilter === c.id ? "font-medium text-ink" : "text-ink-2")}>
                <span className="truncate">{c.name}</span>
                <span className="ml-2 text-xs text-ink-3">{c.documentCount}</span>
              </Link>
              <IconButton label={`Delete course ${c.name}`} className="size-7 opacity-0 group-hover:opacity-100 focus:opacity-100" onClick={() => setDeleteCourse(c)}>
                <Trash2 className="size-3.5" />
              </IconButton>
            </div>
          ))}
          {newCourse.open ? (
            <form
              className="space-y-2 px-1 pt-2"
              onSubmit={(e) => {
                e.preventDefault();
                void createCourse();
              }}
            >
              <Input autoFocus placeholder="e.g. FIN101 Finance" value={newCourse.name} onChange={(e) => setNewCourse({ open: true, name: e.target.value })} aria-label="Course name" />
              {newCourse.error && <p className="text-xs text-bad">{newCourse.error}</p>}
              <div className="flex gap-2">
                <Button size="sm" variant="primary" type="submit" disabled={!newCourse.name.trim()}>
                  Create
                </Button>
                <Button size="sm" variant="ghost" type="button" onClick={() => setNewCourse({ open: false, name: "" })}>
                  Cancel
                </Button>
              </div>
            </form>
          ) : (
            <button onClick={() => setNewCourse({ open: true, name: "" })} className="mt-1 flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm font-medium text-action hover:bg-action-soft">
              <FolderPlus className="size-4" /> New course
            </button>
          )}
        </aside>

        <div className="min-w-0 space-y-6">
          {/* Upload */}
          <Panel>
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-rule px-4 py-3">
              <h2 className="text-[15px] font-semibold">Add material</h2>
              <Segmented
                label="Add material by"
                value={mode}
                onChange={setMode}
                options={[
                  { value: "file", label: "Upload files" },
                  { value: "paste", label: "Paste notes" },
                ]}
              />
            </div>
            <div className="space-y-4 p-4">
              <div className="grid gap-3 sm:max-w-sm">
                <Field label="Course" htmlFor="target-course">
                  <Select id="target-course" value={targetCourse} onChange={(e) => setTargetCourse(e.target.value)}>
                    <option value="">No course</option>
                    {courseList.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </Select>
                </Field>
              </div>

              {mode === "file" ? (
                <div
                  onDragOver={(e) => {
                    e.preventDefault();
                    setDragging(true);
                  }}
                  onDragLeave={() => setDragging(false)}
                  onDrop={(e) => {
                    e.preventDefault();
                    setDragging(false);
                    const files = Array.from(e.dataTransfer.files);
                    if (files.length) void processQueue(files);
                  }}
                  className={cx(
                    "flex flex-col items-center justify-center rounded-lg border-2 border-dashed px-6 py-9 text-center transition-colors",
                    dragging ? "border-action bg-action-soft" : "border-rule-strong bg-surface-2",
                  )}
                >
                  <UploadCloud className="size-8 text-ink-3" aria-hidden />
                  <p className="mt-2 text-sm font-medium text-ink">Drag files here, or</p>
                  <Button className="mt-2" variant="primary" onClick={() => fileInput.current?.click()}>
                    Choose files
                  </Button>
                  <input
                    ref={fileInput}
                    type="file"
                    multiple
                    accept={ACCEPT}
                    className="sr-only"
                    aria-label="Choose files to upload"
                    onChange={(e) => {
                      const files = Array.from(e.target.files ?? []);
                      e.target.value = "";
                      if (files.length) void processQueue(files);
                    }}
                  />
                  <p className="mt-3 text-xs text-ink-3">PDF, Word (.docx), PowerPoint (.pptx), .txt or .md. Scanned pages (images) can&apos;t be read.</p>
                </div>
              ) : (
                <div className="space-y-3">
                  <Field label="Title" htmlFor="paste-title">
                    <Input id="paste-title" placeholder="e.g. Lecture 5 notes" value={paste.title} onChange={(e) => setPaste({ ...paste, title: e.target.value })} />
                  </Field>
                  <Field label="Notes" htmlFor="paste-text" hint="Markdown headings (# Heading) become sections that answers can point to.">
                    <Textarea id="paste-text" rows={8} placeholder="Paste lecture notes here…" value={paste.text} onChange={(e) => setPaste({ ...paste, text: e.target.value })} />
                  </Field>
                  <ErrorNotice error={pasteError} compact />
                  <Button variant="primary" icon={<ClipboardPaste className="size-4" />} busy={pasting} disabled={paste.text.trim().length < 20} onClick={() => void submitPaste()}>
                    Save notes
                  </Button>
                </div>
              )}

              {items.length > 0 && (
                <ul className="divide-y divide-rule rounded-md border border-rule">
                  {items.map((it) => (
                    <li key={it.key} className="flex items-start gap-3 px-3 py-2.5 text-sm">
                      <span className="mt-0.5">
                        {it.state === "done" ? (
                          <CheckCircle2 className="size-4 text-ok" />
                        ) : it.state === "error" ? (
                          <XCircle className="size-4 text-bad" />
                        ) : (
                          <Spinner />
                        )}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium text-ink">{it.name}</span>
                        <span className="block text-xs text-ink-2">
                          {it.state === "queued" && "Waiting…"}
                          {it.state === "uploading" && `Uploading ${it.progress}%`}
                          {it.state === "processing" && "Extracting text and building the index…"}
                          {it.state === "done" && (
                            <>
                              Ready.{" "}
                              <Link href={`/materials/${it.docId}`} className="font-medium text-action hover:underline">
                                Open
                              </Link>
                            </>
                          )}
                          {it.state === "error" && <span className="text-bad">{it.error?.message}</span>}
                          {it.state === "error" && it.error?.fix && <span className="block text-ink-2">{it.error.fix}</span>}
                        </span>
                      </span>
                      <span className="text-xs text-ink-3">{formatBytes(it.size)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </Panel>

          {/* Document list */}
          <Panel>
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-rule px-4 py-3">
              <h2 className="text-[15px] font-semibold">
                {courseFilter ? courseList.find((c) => c.id === courseFilter)?.name ?? "Course" : "All materials"}
              </h2>
              <div className="relative w-full sm:w-64">
                <Search className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-ink-3" aria-hidden />
                <Input className="pl-8" placeholder="Search materials" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search materials" />
              </div>
            </div>
            {docs.error && (
              <div className="p-4">
                <ErrorNotice error={docs.error} onRetry={docs.reload} />
              </div>
            )}
            {docs.loading && !docs.data ? (
              <div className="flex items-center gap-2 p-4 text-sm text-ink-2">
                <Spinner /> Loading…
              </div>
            ) : visible.length === 0 ? (
              <EmptyState icon={<UploadCloud className="size-7" />} title={query ? "No materials match your search" : "No materials here yet"}>
                {query ? "Try a different word." : "Upload a lecture above. The sample files in the project's samples/ folder are a good start."}
              </EmptyState>
            ) : (
              <ul className="divide-y divide-rule">
                {visible.map((d) => (
                  <li key={d.id} className="group flex items-center gap-3 px-4 py-3 hover:bg-surface-2">
                    <DocIcon type={d.fileType} className="size-5" />
                    <Link href={`/materials/${d.id}`} className="min-w-0 flex-1">
                      <span className="flex items-center gap-2">
                        <span className="truncate text-sm font-medium text-ink group-hover:text-action">{d.title}</span>
                        {d.warning && <AlertTriangle className="size-3.5 shrink-0 text-warn" aria-label="Has a warning" />}
                      </span>
                      <span className="block truncate text-xs text-ink-3">
                        {d.courseName ?? "No course"}, {unitWord(d.unitKind, d.unitCount)}, {d.wordCount.toLocaleString()} words, added {formatDate(d.createdAt)}
                      </span>
                    </Link>
                    <IndexBadge doc={d} />
                    <div className="flex">
                      <IconButton
                        label={`Edit ${d.title}`}
                        onClick={() => {
                          setRenameDoc(d);
                          setRenameValue({ title: d.title, description: d.description ?? "", courseId: d.courseId ? String(d.courseId) : "" });
                        }}
                      >
                        <Pencil className="size-4" />
                      </IconButton>
                      <IconButton label={`Delete ${d.title}`} onClick={() => setDeleteDoc(d)}>
                        <Trash2 className="size-4" />
                      </IconButton>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>
      </div>

      <Dialog
        open={renameDoc !== null}
        onClose={() => setRenameDoc(null)}
        title="Edit material"
        footer={
          <>
            <Button variant="ghost" onClick={() => setRenameDoc(null)}>
              Cancel
            </Button>
            <Button variant="primary" busy={busy} disabled={!renameValue.title.trim()} onClick={() => void saveRename()}>
              Save changes
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <Field label="Title" htmlFor="rename-title">
            <Input id="rename-title" value={renameValue.title} onChange={(e) => setRenameValue({ ...renameValue, title: e.target.value })} />
          </Field>
          <Field label="Description" htmlFor="rename-desc">
            <Textarea id="rename-desc" rows={3} value={renameValue.description} onChange={(e) => setRenameValue({ ...renameValue, description: e.target.value })} />
          </Field>
          <Field label="Course" htmlFor="rename-course">
            <Select id="rename-course" value={renameValue.courseId} onChange={(e) => setRenameValue({ ...renameValue, courseId: e.target.value })}>
              <option value="">No course</option>
              {courseList.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </Field>
        </div>
      </Dialog>

      <ConfirmDialog
        open={deleteDoc !== null}
        title="Delete this material?"
        body={
          <>
            “{deleteDoc?.title}” will be removed from this computer, including its stored file and search index. Notes and quizzes made from it are kept.
          </>
        }
        confirmLabel="Delete material"
        busy={busy}
        onConfirm={() => void confirmDeleteDoc()}
        onClose={() => setDeleteDoc(null)}
      />
      <ConfirmDialog
        open={deleteCourse !== null}
        title="Delete this course?"
        body={<>The course “{deleteCourse?.name}” will be deleted. Its materials are kept and moved to “No course”.</>}
        confirmLabel="Delete course"
        busy={busy}
        onConfirm={() => void confirmDeleteCourse()}
        onClose={() => setDeleteCourse(null)}
      />
    </PageContainer>
  );
}

export default function MaterialsPage() {
  return (
    <Suspense fallback={null}>
      <MaterialsInner />
    </Suspense>
  );
}
