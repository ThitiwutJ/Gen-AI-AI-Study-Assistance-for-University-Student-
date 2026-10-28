"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BookMarked, Check, ChevronDown, Copy, Lightbulb, MessageSquarePlus, PanelLeft, Pencil, SendHorizontal, Sparkles, Trash2 } from "lucide-react";
import { Markdown } from "@/components/Markdown";
import { AIReadiness, JobProgress, ScopePicker, useJobActivity, type ScopeValue } from "@/components/shared";
import { useAIStatus, useToast } from "@/components/shell/providers";
import { Badge, Button, ConfirmDialog, Dialog, ErrorNotice, IconButton, Input, Segmented, Select, Spinner, Textarea, cx, formatDate } from "@/components/ui";
import { api, ApiError, useApi, useJob } from "@/hooks/api";
import type { ConversationDetail, ConversationSummary, Course, DocumentSummary, LanguagePref, Level, MessageView, SourceRef } from "@/lib/types";

const SUGGESTIONS = [
  "Explain this like I'm learning it for the first time.",
  "Give me a practical example.",
  "Explain this step by step.",
  "What are the most important exam concepts?",
  "Compare these two concepts.",
  "Test my understanding without revealing the answer immediately.",
];

const FOLLOW_UPS = [
  { label: "Explain more simply", text: "I didn't fully understand. Can you explain that more simply, with an everyday analogy?" },
  { label: "Give an example", text: "Give me a practical, worked example of that." },
  { label: "Common mistakes", text: "What are the common mistakes or misunderstandings students have about this?" },
  { label: "Quiz me", text: "Ask me 3 review questions about this to test my understanding. Don't reveal the answers until I reply." },
];

function GroundingBadge({ message }: { message: MessageView }) {
  const g = message.meta?.grounding;
  if (g === "materials") return <Badge tone="ok">From your materials</Badge>;
  if (g === "not_found") return <Badge tone="warn">Not found in your materials</Badge>;
  if (g === "uncited") return <Badge>Sources found, none cited</Badge>;
  if (g === "general") return <Badge>General knowledge</Badge>;
  return null;
}

function SourcesList({ sources, highlight }: { sources: SourceRef[]; highlight: string | null }) {
  const [showOthers, setShowOthers] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  if (!sources.length) return null;
  const cited = sources.filter((s) => s.cited);
  const others = sources.filter((s) => !s.cited);
  const shown = cited.length ? [...cited, ...(showOthers ? others : [])] : sources;

  return (
    <div className="mt-4 border-t border-rule pt-3">
      <p className="mb-2 flex items-center gap-1.5 text-[13px] font-semibold text-ink-2">
        <BookMarked className="size-3.5" aria-hidden /> Sources from your materials
      </p>
      <ol className="space-y-1.5">
        {shown.map((s) => (
          <li
            key={s.label}
            id={`source-${s.label}`}
            className={cx("rounded-md border px-3 py-2 text-[13px] transition-colors", highlight === s.label ? "border-mark-strong bg-mark/40" : "border-rule bg-surface")}
          >
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
              <span className="cite !m-0 !text-[11px]">{s.label}</span>
              <Link href={`/materials/${s.documentId}#u-${s.unitStart}`} className="font-medium text-ink hover:text-action hover:underline">
                {s.documentTitle}
              </Link>
              <span className="text-ink-3">{s.location}</span>
              {!s.cited && <span className="text-ink-3">(retrieved, not cited)</span>}
            </div>
            <button
              type="button"
              onClick={() => setExpanded(expanded === s.label ? null : s.label)}
              className={cx("mt-1 block w-full text-left font-[family-name:var(--font-reading)] text-ink-2", expanded !== s.label && "line-clamp-2")}
              aria-expanded={expanded === s.label}
              title={expanded === s.label ? "Show less" : "Show the full excerpt"}
            >
              {s.excerpt}
            </button>
          </li>
        ))}
      </ol>
      {cited.length > 0 && others.length > 0 && (
        <button className="mt-2 inline-flex items-center gap-1 text-[13px] font-medium text-action hover:underline" onClick={() => setShowOthers((v) => !v)}>
          <ChevronDown className={cx("size-3.5 transition-transform", showOthers && "rotate-180")} />
          {showOthers ? "Hide" : "Show"} {others.length} more retrieved {others.length === 1 ? "passage" : "passages"}
        </button>
      )}
    </div>
  );
}

function AssistantMessage({ message, onFollowUp, disabled }: { message: MessageView; onFollowUp: (text: string) => void; disabled: boolean }) {
  const [highlight, setHighlight] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const titles = useMemo(() => Object.fromEntries(message.sources.map((s) => [s.label, `${s.documentTitle}, ${s.location}`])), [message.sources]);
  return (
    <div className="group">
      <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-ink-3">
        <Sparkles className="size-3.5 text-action" aria-hidden />
        <span className="font-medium text-ink-2">Gen AI</span>
        {message.model && <span>{message.model}</span>}
        <GroundingBadge message={message} />
        {message.meta?.removedCitations?.length ? (
          <span title="The model cited sources that weren't provided; those marks were removed.">
            {message.meta.removedCitations.length} invalid citation{message.meta.removedCitations.length > 1 ? "s" : ""} removed
          </span>
        ) : null}
      </div>
      <Markdown
        citeTitles={titles}
        onCite={(label) => {
          setHighlight(label);
          document.getElementById(`source-${label}`)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
          setTimeout(() => setHighlight(null), 2000);
        }}
      >
        {message.content}
      </Markdown>
      <SourcesList sources={message.sources} highlight={highlight} />
      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        <Button
          size="sm"
          variant="ghost"
          icon={copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
          onClick={() => {
            void navigator.clipboard.writeText(message.content).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            });
          }}
        >
          {copied ? "Copied" : "Copy"}
        </Button>
        {FOLLOW_UPS.map((f) => (
          <Button key={f.label} size="sm" variant="ghost" disabled={disabled} onClick={() => onFollowUp(f.text)}>
            {f.label}
          </Button>
        ))}
      </div>
    </div>
  );
}

function TutorInner() {
  const router = useRouter();
  const params = useSearchParams();
  const toast = useToast();
  const { status } = useAIStatus();
  const activeId = params.get("c") ? Number(params.get("c")) : null;
  const docParam = params.get("doc") ? Number(params.get("doc")) : null;

  const list = useApi<ConversationSummary[]>("/api/conversations");
  const courses = useApi<Course[]>("/api/courses");
  const documents = useApi<DocumentSummary[]>("/api/documents");
  const conv = useApi<ConversationDetail>(activeId ? `/api/conversations/${activeId}` : null);

  const [scope, setScope] = useState<ScopeValue>({ scope: docParam ? "documents" : "all", courseId: null, documentIds: docParam ? [docParam] : [] });
  const [level, setLevel] = useState<Level>("standard");
  const [language, setLanguage] = useState<LanguagePref>("auto");
  const [draft, setDraft] = useState("");
  const [jobId, setJobId] = useState<string | null>(null);
  const [failure, setFailure] = useState<{ message: string; fix?: string } | null>(null);
  const [sending, setSending] = useState(false);
  const [showList, setShowList] = useState(false);
  const [renaming, setRenaming] = useState<ConversationSummary | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [deleting, setDeleting] = useState<ConversationSummary | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Load a conversation's saved context when it opens (adjusting state during render).
  const loadedConv = conv.data;
  const [syncedConvId, setSyncedConvId] = useState<number | null>(null);
  if (loadedConv && loadedConv.id !== syncedConvId) {
    setSyncedConvId(loadedConv.id);
    setScope({ scope: loadedConv.scope, courseId: loadedConv.courseId, documentIds: loadedConv.documentIds });
    setLevel(loadedConv.level);
    setLanguage(loadedConv.language);
  }

  // New chat with no documents uploaded yet: default to general knowledge.
  const noDocuments = !activeId && !docParam && documents.data?.length === 0;
  const [appliedNoDocs, setAppliedNoDocs] = useState(false);
  if (noDocuments && !appliedNoDocs) {
    setAppliedNoDocs(true);
    setScope({ scope: "none", courseId: null, documentIds: [] });
  }

  const reloadConv = conv.reload;
  const reloadList = list.reload;
  const { job, cancel } = useJob<{ message: MessageView }>(jobId, (finished) => {
    setJobId(null);
    if (finished.status === "done") {
      setFailure(null);
      void reloadConv();
      void reloadList();
    } else if (finished.status === "cancelled") {
      setFailure({ message: "Stopped. Your question is saved; you can retry it." });
    } else {
      setFailure(finished.error ?? { message: "Something went wrong." });
    }
  });
  useJobActivity(job);

  const messages = useMemo(() => conv.data?.messages ?? [], [conv.data]);
  const lastIsUnanswered = messages.length > 0 && messages[messages.length - 1].role === "user" && !jobId;

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length, job?.partial, jobId, failure]);

  const send = useCallback(
    async (text: string, retry = false) => {
      if ((!text.trim() && !retry) || sending || jobId) return;
      setSending(true);
      setFailure(null);
      try {
        let id = activeId;
        if (!id) {
          const created = await api<ConversationSummary>("/api/conversations", {
            method: "POST",
            json: { scope: scope.scope, courseId: scope.courseId, documentIds: scope.documentIds, level, language },
          });
          id = created.id;
          router.replace(`/tutor?c=${id}`);
        }
        const body = { scope: scope.scope, courseId: scope.courseId, documentIds: scope.documentIds, level, language, ...(retry ? { retry: true } : { content: text }) };
        const started = await api<{ id: string }>(`/api/conversations/${id}/messages`, { method: "POST", json: body });
        if (!retry) setDraft("");
        setJobId(started.id);
        if (activeId === id) void conv.reload();
        void list.reload();
      } catch (e) {
        const err = e instanceof ApiError ? e : new ApiError("unknown", String(e));
        setFailure({ message: err.message, fix: err.fix });
      } finally {
        setSending(false);
      }
    },
    [activeId, scope, level, language, sending, jobId, router, conv, list],
  );

  function newChat() {
    setFailure(null);
    setJobId(null);
    setDraft("");
    router.push("/tutor");
    setShowList(false);
    setTimeout(() => inputRef.current?.focus(), 50);
  }

  async function saveRename() {
    if (!renaming) return;
    try {
      await api(`/api/conversations/${renaming.id}`, { method: "PATCH", json: { title: renameValue } });
      setRenaming(null);
      void list.reload();
      if (renaming.id === activeId) void conv.reload();
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), "bad");
    }
  }

  async function confirmDelete() {
    if (!deleting) return;
    try {
      await api(`/api/conversations/${deleting.id}`, { method: "DELETE" });
      toast("Conversation deleted.");
      if (deleting.id === activeId) router.push("/tutor");
      setDeleting(null);
      void list.reload();
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), "bad");
    }
  }

  const running = Boolean(jobId);
  const title = conv.data?.title ?? "New conversation";

  return (
    <div className="flex h-[calc(100dvh-56px)] lg:h-dvh">
      {/* Conversation list */}
      <aside
        className={cx(
          "w-[264px] shrink-0 flex-col border-r border-rule bg-surface-2",
          showList ? "fixed inset-y-0 left-0 top-14 z-20 flex shadow-xl lg:static lg:shadow-none" : "hidden lg:flex",
        )}
        aria-label="Conversations"
      >
        <div className="p-3">
          <Button variant="primary" className="w-full" icon={<MessageSquarePlus className="size-4" />} onClick={newChat}>
            New chat
          </Button>
        </div>
        <div className="flex-1 overflow-y-auto px-2 pb-3">
          {list.data?.length === 0 && <p className="px-2 py-3 text-[13px] text-ink-3">Your conversations are saved here.</p>}
          {list.data?.map((c) => (
            <div key={c.id} className={cx("group flex items-center rounded-md", c.id === activeId ? "bg-black/[0.07]" : "hover:bg-black/[0.04]")}>
              <Link href={`/tutor?c=${c.id}`} onClick={() => setShowList(false)} className="min-w-0 flex-1 px-2.5 py-2">
                <span className={cx("block truncate text-[13.5px]", c.id === activeId ? "font-medium text-ink" : "text-ink-2")}>{c.title}</span>
                <span className="block text-[11.5px] text-ink-3">{formatDate(c.updatedAt)}</span>
              </Link>
              <div className="flex pr-1 opacity-0 group-hover:opacity-100 focus-within:opacity-100">
                <IconButton
                  label="Rename conversation"
                  className="size-7"
                  onClick={() => {
                    setRenaming(c);
                    setRenameValue(c.title);
                  }}
                >
                  <Pencil className="size-3.5" />
                </IconButton>
                <IconButton label="Delete conversation" className="size-7" onClick={() => setDeleting(c)}>
                  <Trash2 className="size-3.5" />
                </IconButton>
              </div>
            </div>
          ))}
        </div>
      </aside>

      {/* Chat */}
      <section className="flex min-w-0 flex-1 flex-col bg-paper" aria-label="Chat">
        <div className="border-b border-rule bg-surface px-4 py-2.5 sm:px-6">
          <div className="flex items-center gap-2">
            <IconButton label="Show conversations" className="lg:hidden" onClick={() => setShowList((v) => !v)}>
              <PanelLeft className="size-4" />
            </IconButton>
            <h1 className="min-w-0 flex-1 truncate text-[15px] font-semibold">{title}</h1>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <ScopePicker value={scope} onChange={setScope} courses={courses.data ?? []} documents={documents.data ?? []} />
            <Segmented
              label="Explanation level"
              value={level}
              onChange={setLevel}
              options={[
                { value: "beginner", label: "Beginner" },
                { value: "standard", label: "Standard" },
                { value: "exam", label: "Exam-ready" },
              ]}
            />
            <Select aria-label="Answer language" className="h-8 !w-auto text-[13px]" value={language} onChange={(e) => setLanguage(e.target.value as LanguagePref)}>
              <option value="auto">Answer in: same as question</option>
              <option value="en">Answer in English</option>
              <option value="th">ตอบเป็นภาษาไทย</option>
            </Select>
          </div>
        </div>

        <div ref={scrollRef} className="flex-1 overflow-y-auto">
          <div className="mx-auto max-w-[820px] space-y-7 px-4 py-6 sm:px-6">
            <AIReadiness status={status} compact />

            {conv.loading && !conv.data && activeId && (
              <div className="flex items-center gap-2 text-sm text-ink-2">
                <Spinner /> Loading conversation…
              </div>
            )}
            {conv.error && <ErrorNotice error={conv.error} />}

            {messages.length === 0 && !running && !conv.loading && (
              <div className="pt-6">
                <h2 className="text-xl font-semibold">What are you studying?</h2>
                <p className="mt-1 max-w-[60ch] text-ink-2">
                  Ask about anything in your materials. Answers cite the exact page or slide, and you can open the source to check it. Choose which materials to use above.
                </p>
                <div className="mt-5 grid gap-2 sm:grid-cols-2">
                  {SUGGESTIONS.map((s) => (
                    <button
                      key={s}
                      onClick={() => {
                        setDraft(`${s}\nTopic: `);
                        setTimeout(() => {
                          const el = inputRef.current;
                          if (el) {
                            el.focus();
                            el.setSelectionRange(el.value.length, el.value.length);
                          }
                        }, 0);
                      }}
                      className="flex items-start gap-2 rounded-md border border-rule bg-surface px-3 py-2.5 text-left text-sm text-ink-2 hover:border-rule-strong hover:text-ink"
                    >
                      <Lightbulb className="mt-0.5 size-4 shrink-0 text-ink-3" aria-hidden />
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {messages.map((m) =>
              m.role === "user" ? (
                <div key={m.id} className="flex justify-end">
                  <div className="max-w-[85%] whitespace-pre-wrap rounded-lg bg-[#e9edf3] px-4 py-2.5 text-[15px] text-ink">{m.content}</div>
                </div>
              ) : (
                <AssistantMessage key={m.id} message={m} disabled={running} onFollowUp={(text) => void send(text)} />
              ),
            )}

            {running && (
              <div>
                {job?.partial ? (
                  <>
                    <div className="mb-2 flex items-center gap-2 text-xs text-ink-3">
                      <Sparkles className="size-3.5 text-action" aria-hidden />
                      <span className="font-medium text-ink-2">Gen AI</span>
                      <span>{status?.chat.model}</span>
                    </div>
                    <Markdown streaming>{job.partial}</Markdown>
                    <Button size="sm" variant="ghost" className="mt-2" onClick={() => void cancel()}>
                      Stop
                    </Button>
                  </>
                ) : (
                  <JobProgress job={job} onCancel={() => void cancel()} />
                )}
              </div>
            )}

            {failure && (
              <ErrorNotice
                error={failure}
                onRetry={lastIsUnanswered || messages[messages.length - 1]?.role === "user" ? () => void send("", true) : undefined}
              />
            )}
            {!failure && lastIsUnanswered && !sending && (
              <div className="flex items-center gap-3 rounded-md border border-rule bg-surface px-4 py-3 text-sm">
                <span className="flex-1 text-ink-2">This question hasn&apos;t been answered yet.</span>
                <Button size="sm" variant="primary" onClick={() => void send("", true)}>
                  Answer it now
                </Button>
              </div>
            )}
          </div>
        </div>

        <div className="border-t border-rule bg-surface px-4 py-3 sm:px-6">
          <form
            className="mx-auto flex max-w-[820px] items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void send(draft);
            }}
          >
            <Textarea
              ref={inputRef}
              rows={Math.min(8, Math.max(1, draft.split("\n").length))}
              placeholder={running ? "Wait for the answer, or press Stop…" : "Ask a question about your materials…"}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  void send(draft);
                }
              }}
              aria-label="Your question"
              className="max-h-56 min-h-10 resize-none"
            />
            <Button type="submit" variant="primary" className="h-10" busy={sending} disabled={running || !draft.trim()} aria-label="Send question">
              <SendHorizontal className="size-4" />
            </Button>
          </form>
          <p className="mx-auto mt-1.5 max-w-[820px] text-[11.5px] text-ink-3">
            Runs on your local model. Enter to send, Shift+Enter for a new line. AI answers can be wrong; check the cited source.
          </p>
        </div>
      </section>

      <Dialog
        open={renaming !== null}
        onClose={() => setRenaming(null)}
        title="Rename conversation"
        footer={
          <>
            <Button variant="ghost" onClick={() => setRenaming(null)}>
              Cancel
            </Button>
            <Button variant="primary" disabled={!renameValue.trim()} onClick={() => void saveRename()}>
              Save
            </Button>
          </>
        }
      >
        <Input aria-label="Conversation title" value={renameValue} onChange={(e) => setRenameValue(e.target.value)} />
      </Dialog>
      <ConfirmDialog
        open={deleting !== null}
        title="Delete this conversation?"
        body={<>“{deleting?.title}” and all its messages will be deleted from this computer.</>}
        confirmLabel="Delete conversation"
        onConfirm={() => void confirmDelete()}
        onClose={() => setDeleting(null)}
      />
    </div>
  );
}

export default function TutorPage() {
  return (
    <Suspense fallback={null}>
      <TutorInner />
    </Suspense>
  );
}
