"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import { ArrowLeft, Check, Copy, Download, ListChecks, MessagesSquare, Pencil, Trash2 } from "lucide-react";
import { Markdown } from "@/components/Markdown";
import { kindLabel } from "@/components/notes-kinds";
import { PageContainer } from "@/components/shell/AppShell";
import { useToast } from "@/components/shell/providers";
import { Badge, Button, ConfirmDialog, ErrorNotice, Input, Panel, Spinner, formatDate } from "@/components/ui";
import { api, useApi } from "@/hooks/api";
import type { NoteDetail } from "@/lib/types";

export default function NotePage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const toast = useToast();
  const note = useApi<NoteDetail>(`/api/notes/${id}`);
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState("");
  const [copied, setCopied] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const n = note.data;
  if (note.loading && !n) {
    return (
      <PageContainer>
        <div className="flex items-center gap-2 text-ink-2">
          <Spinner /> Loading note…
        </div>
      </PageContainer>
    );
  }
  if (note.error || !n) {
    return (
      <PageContainer>
        <ErrorNotice error={note.error ?? { message: "Note not found." }} />
      </PageContainer>
    );
  }

  async function saveTitle() {
    try {
      await api(`/api/notes/${id}`, { method: "PATCH", json: { title } });
      setEditing(false);
      toast("Note renamed.");
      void note.reload();
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), "bad");
    }
  }

  function download() {
    const blob = new Blob([`# ${n!.title}\n\n${n!.content}\n`], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${n!.title.replace(/[\\/:*?"<>|]+/g, "-").slice(0, 80)}.md`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function remove() {
    try {
      await api(`/api/notes/${id}`, { method: "DELETE" });
      toast("Note deleted.");
      router.push("/notes");
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), "bad");
    }
  }

  return (
    <PageContainer>
      <Link href="/notes" className="mb-4 inline-flex items-center gap-1 text-[13px] font-medium text-ink-2 hover:text-ink">
        <ArrowLeft className="size-4" /> Summaries & notes
      </Link>

      <header className="mb-5">
        {editing ? (
          <form
            className="flex flex-wrap gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void saveTitle();
            }}
          >
            <Input autoFocus className="h-10 max-w-xl text-lg" value={title} onChange={(e) => setTitle(e.target.value)} aria-label="Note title" />
            <Button variant="primary" type="submit" disabled={!title.trim()}>
              Save
            </Button>
            <Button variant="ghost" type="button" onClick={() => setEditing(false)}>
              Cancel
            </Button>
          </form>
        ) : (
          <h1 className="text-[26px] font-semibold leading-tight">{n.title}</h1>
        )}
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-ink-2">
          <Badge tone="action">{kindLabel(n.kind)}</Badge>
          {n.documentId ? (
            <Link href={`/materials/${n.documentId}`} className="hover:text-action hover:underline">
              From: {n.documentTitle}
            </Link>
          ) : (
            <span>Source material was deleted</span>
          )}
          {n.model && <span>Written by {n.model}</span>}
          <span>{formatDate(n.createdAt)}</span>
          {n.meta?.staged && <span>Summarized in {n.meta.parts} parts, then combined</span>}
        </div>
      </header>

      <div className="mb-5 flex flex-wrap gap-2">
        <Button
          size="sm"
          icon={copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
          onClick={() =>
            void navigator.clipboard.writeText(n.content).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            })
          }
        >
          {copied ? "Copied" : "Copy"}
        </Button>
        <Button size="sm" icon={<Download className="size-3.5" />} onClick={download}>
          Download .md
        </Button>
        <Button
          size="sm"
          icon={<Pencil className="size-3.5" />}
          onClick={() => {
            setTitle(n.title);
            setEditing(true);
          }}
        >
          Rename
        </Button>
        {n.documentId && (
          <>
            <Link href={`/tutor?doc=${n.documentId}`}>
              <Button size="sm" icon={<MessagesSquare className="size-3.5" />}>
                Ask the tutor
              </Button>
            </Link>
            <Link href={`/quizzes?doc=${n.documentId}`}>
              <Button size="sm" icon={<ListChecks className="size-3.5" />}>
                Quiz me
              </Button>
            </Link>
          </>
        )}
        <Button size="sm" variant="danger" icon={<Trash2 className="size-3.5" />} onClick={() => setConfirmDelete(true)}>
          Delete
        </Button>
      </div>

      <Panel className="px-6 py-6 sm:px-10 sm:py-8">
        <Markdown>{n.content}</Markdown>
        {n.meta?.removedRefs?.length ? (
          <p className="mt-6 border-t border-rule pt-3 text-xs text-ink-3">
            {n.meta.removedRefs.length} page reference{n.meta.removedRefs.length > 1 ? "s" : ""} pointing to pages that don&apos;t exist in the material {n.meta.removedRefs.length > 1 ? "were" : "was"} removed.
          </p>
        ) : null}
      </Panel>
      <p className="mt-3 text-xs text-ink-3">AI-generated from your material. Check important details against the original.</p>

      <ConfirmDialog
        open={confirmDelete}
        title="Delete this note?"
        body={<>“{n.title}” will be deleted from this computer.</>}
        confirmLabel="Delete note"
        onConfirm={() => void remove()}
        onClose={() => setConfirmDelete(false)}
      />
    </PageContainer>
  );
}
