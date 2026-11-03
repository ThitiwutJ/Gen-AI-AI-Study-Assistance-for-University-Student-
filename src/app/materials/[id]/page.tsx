"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState, useSyncExternalStore } from "react";
import { AlertTriangle, ArrowLeft, Download, ExternalLink, FileText, ListChecks, MessagesSquare, NotebookPen, RefreshCw, Trash2 } from "lucide-react";
import { DocIcon, IndexBadge, unitWord } from "@/components/shared";
import { PageContainer } from "@/components/shell/AppShell";
import { useToast } from "@/components/shell/providers";
import { Badge, Button, ConfirmDialog, ErrorNotice, Panel, PanelHeader, Segmented, Spinner, buttonClass, cx, formatBytes, formatDate } from "@/components/ui";
import { api, useApi } from "@/hooks/api";
import type { DocumentDetail, NoteSummary } from "@/lib/types";

const TYPE_LABEL: Record<string, string> = { pdf: "PDF", docx: "Word", pptx: "PowerPoint", txt: "Text", md: "Markdown", paste: "Pasted notes" };
const OPENS_IN_BROWSER = new Set(["pdf", "txt", "md"]);

function subscribeHash(onChange: () => void) {
  window.addEventListener("hashchange", onChange);
  return () => window.removeEventListener("hashchange", onChange);
}

/** The URL hash (#u-3 links to a cited page), kept in sync when it changes. */
function useLocationHash(): string {
  return useSyncExternalStore(subscribeHash, () => window.location.hash, () => "");
}

/**
 * The uploaded PDF, shown with the browser's own PDF viewer (opened at `page`).
 * The bytes are fetched as JSON and shown from a local blob: URL, because download managers
 * such as Internet Download Manager grab any PDF response and the frame would stay empty.
 */
function OriginalFile({ id, title, page }: { id: number; title: string; page: number }) {
  const direct = `/api/documents/${id}/file`;
  const [loaded, setLoaded] = useState<{ id: number; url: string } | { id: number; error: string } | null>(null);
  useEffect(() => {
    let url: string | null = null;
    let cancelled = false;
    fetch(`${direct}?format=base64`)
      .then(async (res) => {
        const body = (await res.json()) as { data?: string; error?: { message: string } };
        if (!res.ok || !body.data) throw new Error(body.error?.message ?? `The file couldn't be loaded (HTTP ${res.status}).`);
        const blob = await (await fetch(`data:application/pdf;base64,${body.data}`)).blob();
        url = URL.createObjectURL(blob);
        if (cancelled) URL.revokeObjectURL(url);
        else setLoaded({ id, url });
      })
      .catch((e: unknown) => {
        if (!cancelled) setLoaded({ id, error: e instanceof Error ? e.message : String(e) });
      });
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [id, direct]);

  const current = loaded?.id === id ? loaded : null;
  return (
    <div>
      {current && "url" in current ? (
        <iframe key={page} src={`${current.url}#page=${page}`} title={`${title} (original PDF)`} className="block h-[78vh] min-h-[420px] w-full border-0 bg-surface-2" />
      ) : current && "error" in current ? (
        <div className="p-5">
          <ErrorNotice error={{ message: current.error }} />
        </div>
      ) : (
        <div className="flex h-[40vh] items-center justify-center gap-2 text-sm text-ink-2">
          <Spinner /> Opening the PDF…
        </div>
      )}
      <p className="border-t border-rule px-5 py-2.5 text-[12.5px] text-ink-3">
        PDF not showing (some phone browsers can&apos;t display PDFs in a page)?{" "}
        <a href={current && "url" in current ? current.url : direct} target="_blank" rel="noreferrer" className="font-medium text-action hover:underline">
          Open it in a new tab
        </a>
        .
      </p>
    </div>
  );
}

export default function MaterialDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const toast = useToast();
  const doc = useApi<DocumentDetail>(`/api/documents/${id}?touch=1`);
  const notes = useApi<NoteSummary[]>(`/api/notes?documentId=${id}`);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  // A link to a cited page (#u-3) opens the extracted text; otherwise a PDF opens as the original file.
  // A choice made with the tabs holds until the link (hash) changes.
  const hash = useLocationHash();
  const [viewChoice, setViewChoiceState] = useState<{ view: "file" | "text"; hash: string } | null>(null);
  const setViewChoice = (view: "file" | "text") => setViewChoiceState({ view, hash });
  const [pdfPage, setPdfPage] = useState(1);

  const d = doc.data;
  const reload = doc.reload;
  const indexing = d?.indexStatus === "indexing" || d?.indexStatus === "pending";
  useEffect(() => {
    if (!indexing) return;
    const t = setInterval(() => void reload(), 2000);
    return () => clearInterval(t);
  }, [indexing, reload]);

  // Jump to a cited page (#u-3) once the text has loaded.
  const loaded = Boolean(d);
  useEffect(() => {
    if (!loaded || !hash.startsWith("#u-")) return;
    const el = document.getElementById(hash.slice(1));
    if (el) {
      el.scrollIntoView({ block: "start" });
      el.classList.add("source-flash");
    }
  }, [loaded, hash]);

  async function reindex() {
    try {
      await api("/api/documents/reindex", { method: "POST", json: { documentId: Number(id) } });
      toast("Re-indexing started.");
      void reload();
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), "bad");
    }
  }

  async function remove() {
    setBusy(true);
    try {
      await api(`/api/documents/${id}`, { method: "DELETE" });
      toast("Material deleted.");
      router.push("/materials");
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), "bad");
      setBusy(false);
    }
  }

  if (doc.loading && !d) {
    return (
      <PageContainer>
        <div className="flex items-center gap-2 text-ink-2">
          <Spinner /> Loading material…
        </div>
      </PageContainer>
    );
  }
  if (doc.error || !d) {
    return (
      <PageContainer>
        <ErrorNotice error={doc.error ?? { message: "Material not found." }} />
        <Link href="/materials" className="mt-4 inline-flex items-center gap-1 text-sm font-medium text-action">
          <ArrowLeft className="size-4" /> Back to materials
        </Link>
      </PageContainer>
    );
  }

  const canShowPdf = d.fileType === "pdf" && d.hasFile;
  const view = !canShowPdf ? "text" : viewChoice && viewChoice.hash === hash ? viewChoice.view : hash.startsWith("#u-") ? "text" : "file";
  const fileUrl = `/api/documents/${d.id}/file`;

  return (
    <PageContainer wide>
      <Link href="/materials" className="mb-4 inline-flex items-center gap-1 text-[13px] font-medium text-ink-2 hover:text-ink">
        <ArrowLeft className="size-4" /> Study materials
      </Link>
      <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-[13px] text-ink-3">
            <DocIcon type={d.fileType} />
            {TYPE_LABEL[d.fileType]}
            {d.courseName && (
              <>
                <span aria-hidden>/</span>
                <Link href={`/materials?course=${d.courseId}`} className="hover:text-ink">
                  {d.courseName}
                </Link>
              </>
            )}
          </div>
          <h1 className="mt-1 text-[26px] font-semibold leading-tight">{d.title}</h1>
          {d.description && <p className="mt-1 max-w-[70ch] text-ink-2">{d.description}</p>}
        </div>
        <div className="flex flex-wrap gap-2">
          {d.hasFile &&
            (OPENS_IN_BROWSER.has(d.fileType) ? (
              <a href={fileUrl} target="_blank" rel="noreferrer" className={buttonClass()}>
                <ExternalLink className="size-4" aria-hidden /> Open file
              </a>
            ) : (
              <a href={`${fileUrl}?download=1`} download={d.fileName ?? undefined} className={buttonClass()}>
                <Download className="size-4" aria-hidden /> Download file
              </a>
            ))}
          <Link href={`/tutor?doc=${d.id}`}>
            <Button variant="primary" icon={<MessagesSquare className="size-4" />} disabled={!d.searchable}>
              Ask about this
            </Button>
          </Link>
          <Link href={`/notes?doc=${d.id}`}>
            <Button icon={<NotebookPen className="size-4" />} disabled={!d.searchable}>
              Summarize
            </Button>
          </Link>
          <Link href={`/quizzes?doc=${d.id}`}>
            <Button icon={<ListChecks className="size-4" />} disabled={!d.searchable}>
              Create quiz
            </Button>
          </Link>
        </div>
      </header>

      {d.warning && (
        <div className="mb-6 flex gap-3 rounded-md border border-warn/30 bg-warn-soft px-4 py-3 text-sm" role="alert">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warn" />
          <p className="text-ink">{d.warning}</p>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[1fr_300px]">
        <Panel className="min-w-0 overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-rule px-5 py-3">
            <div className="min-w-0">
              <h2 className="text-[15px] font-semibold">{view === "file" ? "Original file" : "Extracted text"}</h2>
              <p className="text-[13px] text-ink-2">
                {view === "file"
                  ? `${d.fileName ?? d.title}, ${unitWord(d.unitKind, d.unitCount)}${d.sizeBytes ? `, ${formatBytes(d.sizeBytes)}` : ""}`
                  : `${unitWord(d.unitKind, d.unitCount)}. This is exactly what the AI reads.`}
              </p>
            </div>
            {canShowPdf && (
              <Segmented
                label="Show"
                value={view}
                onChange={(v) => setViewChoice(v)}
                options={[
                  { value: "file", label: "Original PDF" },
                  { value: "text", label: "Extracted text" },
                ]}
              />
            )}
          </div>
          {view === "file" ? (
            <OriginalFile id={d.id} title={d.title} page={pdfPage} />
          ) : (
            <div className="divide-y divide-rule">
              {d.units.map((u) => (
                <article key={u.index} id={`u-${u.index}`} className="scroll-mt-20 px-5 py-5">
                  <h2 className="mb-2 flex flex-wrap items-baseline gap-x-2 text-[13px] font-semibold text-ink-3">
                    <span>{u.label}</span>
                    {u.heading && d.unitKind !== "page" && <span className="truncate font-normal">{u.heading}</span>}
                    {canShowPdf && (
                      <button
                        type="button"
                        className="ml-auto inline-flex items-center gap-1 font-medium text-action hover:underline"
                        onClick={() => {
                          setPdfPage(u.index);
                          setViewChoice("file");
                          window.scrollTo({ top: 0 });
                        }}
                      >
                        <FileText className="size-3.5" aria-hidden /> View in PDF
                      </button>
                    )}
                  </h2>
                  <div className="reading whitespace-pre-line text-[15.5px]">{u.text}</div>
                </article>
              ))}
            </div>
          )}
        </Panel>

        <div className="space-y-6 lg:sticky lg:top-6 lg:self-start">
          <Panel>
            <PanelHeader title="Search index" />
            <div className="space-y-3 p-4 text-sm">
              <div className="flex items-center justify-between gap-2">
                <span className="text-ink-2">Status</span>
                <IndexBadge doc={d} />
              </div>
              <p className="text-[13px] text-ink-2">
                {d.indexStatus === "ready" && `${d.chunkCount} passages embedded with ${d.embedModel}. Semantic and keyword search are both on.`}
                {d.indexStatus === "indexing" && `Embedding passages with the local model: ${d.indexedChunks} of ${d.chunkCount}. Keyword search already works.`}
                {d.indexStatus === "pending" && "Waiting for the local embedding model. Keyword search already works."}
                {d.indexStatus === "keyword_only" && "No embedding model is installed, so this material is searched by keywords only. Install one in Settings for better results."}
                {d.indexStatus === "stale" && "The embedding model changed since this was indexed. Re-index to use semantic search again."}
                {d.indexStatus === "failed" && (d.indexError ?? "Indexing failed. Keyword search still works.")}
                {d.indexStatus === "skipped" && "The text couldn't be extracted reliably, so it isn't used for AI answers."}
              </p>
              {(d.indexStatus === "stale" || d.indexStatus === "failed" || d.indexStatus === "ready") && (
                <Button size="sm" icon={<RefreshCw className="size-3.5" />} onClick={() => void reindex()}>
                  Re-index
                </Button>
              )}
            </div>
          </Panel>

          <Panel>
            <PanelHeader title="Details" />
            <dl className="space-y-2 p-4 text-sm">
              {[
                ["File", d.fileName ?? "Pasted notes"],
                ["Chunks", `${d.chunkCount} passages for search`],
                ["Size", formatBytes(d.sizeBytes) || "—"],
                ["Length", `${unitWord(d.unitKind, d.unitCount)}, ${d.wordCount.toLocaleString()} words`],
                ["Language", d.language === "th" ? "Thai" : d.language === "mixed" ? "Thai and English" : "English"],
                ["Added", formatDate(d.createdAt)],
              ].map(([k, v]) => (
                <div key={k} className="flex justify-between gap-3">
                  <dt className="text-ink-3">{k}</dt>
                  <dd className="truncate text-right text-ink">{v}</dd>
                </div>
              ))}
            </dl>
          </Panel>

          <Panel>
            <PanelHeader title="Notes from this material" />
            {notes.data?.length ? (
              <ul className="divide-y divide-rule">
                {notes.data.map((n) => (
                  <li key={n.id}>
                    <Link href={`/notes/${n.id}`} className="block px-4 py-2.5 text-sm text-ink hover:bg-surface-2">
                      {n.title}
                      <span className="block text-xs text-ink-3">{formatDate(n.createdAt)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="px-4 py-3 text-[13px] text-ink-2">None yet. Use “Summarize” to create notes.</p>
            )}
          </Panel>

          {d.units.length > 6 && (
            <Panel>
              <PanelHeader title={`Jump to ${d.unitKind}`} />
              <div className="flex flex-wrap gap-1.5 p-3">
                {d.units.map((u) => (
                  <a key={u.index} href={`#u-${u.index}`} className={cx("rounded border border-rule px-2 py-0.5 text-xs text-ink-2 hover:border-action hover:text-action")}>
                    {u.index}
                  </a>
                ))}
              </div>
            </Panel>
          )}

          <Button variant="danger" icon={<Trash2 className="size-4" />} onClick={() => setConfirmDelete(true)}>
            Delete material
          </Button>
          {d.language && d.language !== "en" && (
            <p className="text-xs text-ink-3">
              <Badge>Thai</Badge> Thai text is searched with a character-based index, so questions in Thai work without spaces between words.
            </p>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={confirmDelete}
        title="Delete this material?"
        body={<>“{d.title}” will be removed from this computer, including its stored file and search index. Notes and quizzes made from it are kept.</>}
        confirmLabel="Delete material"
        busy={busy}
        onConfirm={() => void remove()}
        onClose={() => setConfirmDelete(false)}
      />
    </PageContainer>
  );
}
