"use client";

import Link from "next/link";
import { ArrowUpRight, Check, FileStack, ListChecks, MessagesSquare, NotebookPen, Upload } from "lucide-react";
import { AIReadiness, DocIcon, IndexBadge } from "@/components/shared";
import { PageContainer } from "@/components/shell/AppShell";
import { useAIStatus } from "@/components/shell/providers";
import { Button, EmptyState, ErrorNotice, Panel, PanelHeader, Spinner, cx, formatDate } from "@/components/ui";
import { useApi } from "@/hooks/api";
import type { DashboardData } from "@/lib/types";

function greeting(name: string): string {
  const h = new Date().getHours();
  const part = h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
  return name ? `${part}, ${name}` : `${part}`;
}

const ACTIONS = [
  { href: "/tutor", icon: MessagesSquare, title: "Ask the tutor", text: "Explanations grounded in your own materials, with page references." },
  { href: "/materials", icon: Upload, title: "Add material", text: "Upload a PDF, Word file, slides or paste your notes." },
  { href: "/notes", icon: NotebookPen, title: "Summarize a lecture", text: "Quick overviews, detailed notes or exam notes." },
  { href: "/quizzes", icon: ListChecks, title: "Practice", text: "Generate a quiz and get feedback on every answer." },
];

export default function DashboardPage() {
  const { data, error, loading, reload } = useApi<DashboardData>("/api/dashboard");
  const { status } = useAIStatus();

  if (loading && !data) {
    return (
      <PageContainer>
        <div className="flex items-center gap-2 text-ink-2">
          <Spinner /> Loading your dashboard…
        </div>
      </PageContainer>
    );
  }
  if (error && !data) {
    return (
      <PageContainer>
        <ErrorNotice error={error} onRetry={reload} />
      </PageContainer>
    );
  }
  if (!data) return null;

  const firstTime = data.counts.documents === 0;
  const steps = [
    { done: status?.state === "connected", label: "Connect the local AI", detail: "Ollama running with a chat model installed.", href: "/settings" },
    { done: data.counts.courses > 0, label: "Create a course", detail: "Optional: keeps materials organised by subject.", href: "/materials" },
    { done: data.counts.documents > 0, label: "Upload your first material", detail: "A lecture PDF, slides or notes. Try the files in samples/.", href: "/materials" },
    { done: data.counts.conversations > 0, label: "Ask the tutor a question", detail: "Answers cite the pages they came from.", href: "/tutor" },
    { done: data.counts.attempts > 0, label: "Take a practice quiz", detail: "Your score and feedback are saved.", href: "/quizzes" },
  ];

  return (
    <PageContainer>
      <header className="mb-7 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[28px] font-semibold leading-tight tracking-[-0.01em]">{greeting(data.displayName)}</h1>
          <p className="mt-1.5 max-w-[60ch] text-[15px] text-ink-2">
            Study from your own course materials with an AI tutor that runs entirely on this computer.
          </p>
        </div>
        <div className="flex gap-2">
          <Link href="/materials">
            <Button icon={<Upload className="size-4" />}>Upload material</Button>
          </Link>
          <Link href="/tutor">
            <Button variant="primary" icon={<MessagesSquare className="size-4" />}>
              Start studying
            </Button>
          </Link>
        </div>
      </header>

      <div className="space-y-6">
        <AIReadiness status={status} />

        <nav aria-label="Quick actions" className="grid overflow-hidden rounded-lg border border-rule bg-surface sm:grid-cols-2 lg:grid-cols-4">
          {ACTIONS.map(({ href, icon: Icon, title, text }, i) => (
            <Link
              key={href}
              href={href}
              className={cx(
                "group flex gap-3 p-4 hover:bg-surface-2",
                i > 0 && "border-t border-rule sm:border-t-0",
                i % 2 === 1 && "sm:border-l sm:border-rule",
                i > 1 && "sm:border-t lg:border-t-0",
                i > 0 && "lg:border-l lg:border-rule",
              )}
            >
              <Icon className="mt-0.5 size-5 shrink-0 text-action" aria-hidden />
              <span>
                <span className="flex items-center gap-1 text-sm font-semibold text-ink">
                  {title}
                  <ArrowUpRight className="size-3.5 text-ink-3 opacity-0 transition-opacity group-hover:opacity-100" aria-hidden />
                </span>
                <span className="mt-0.5 block text-[13px] leading-snug text-ink-2">{text}</span>
              </span>
            </Link>
          ))}
        </nav>

        {firstTime && (
          <Panel>
            <PanelHeader title="Getting started" description="Five steps to your first grounded answer. Each one ticks itself off as you go." />
            <ol className="divide-y divide-rule">
              {steps.map((s, i) => (
                <li key={s.label}>
                  <Link href={s.href} className="flex items-center gap-3 px-4 py-3 hover:bg-surface-2">
                    <span
                      className={cx(
                        "flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold",
                        s.done ? "bg-ok text-white" : "border border-rule-strong text-ink-2",
                      )}
                    >
                      {s.done ? <Check className="size-3.5" aria-label="Done" /> : i + 1}
                    </span>
                    <span className="min-w-0">
                      <span className={cx("block text-sm font-medium", s.done ? "text-ink-3 line-through" : "text-ink")}>{s.label}</span>
                      <span className="block text-[13px] text-ink-2">{s.detail}</span>
                    </span>
                  </Link>
                </li>
              ))}
            </ol>
          </Panel>
        )}

        <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
          <div className="min-w-0 space-y-6">
            <Panel>
              <PanelHeader
                title="Recent materials"
                action={
                  <Link href="/materials" className="text-[13px] font-medium text-action hover:underline">
                    All materials
                  </Link>
                }
              />
              {data.recentDocuments.length === 0 ? (
                <EmptyState icon={<FileStack className="size-7" />} title="No materials yet" action={<Link href="/materials"><Button variant="primary">Upload material</Button></Link>}>
                  Upload a lecture to summarize it, ask questions about it, and practise with quizzes.
                </EmptyState>
              ) : (
                <ul className="divide-y divide-rule">
                  {data.recentDocuments.map((d) => (
                    <li key={d.id}>
                      <Link href={`/materials/${d.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-surface-2">
                        <DocIcon type={d.fileType} />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium text-ink">{d.title}</span>
                          <span className="block truncate text-xs text-ink-3">
                            {d.courseName ?? "No course"}, opened {formatDate(d.lastOpenedAt ?? d.createdAt)}
                          </span>
                        </span>
                        <IndexBadge doc={d} />
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>

            <Panel>
              <PanelHeader
                title="Saved notes"
                action={
                  <Link href="/notes" className="text-[13px] font-medium text-action hover:underline">
                    All notes
                  </Link>
                }
              />
              {data.recentNotes.length === 0 ? (
                <p className="px-4 py-5 text-sm text-ink-2">Summaries you generate are saved here automatically.</p>
              ) : (
                <ul className="divide-y divide-rule">
                  {data.recentNotes.map((n) => (
                    <li key={n.id}>
                      <Link href={`/notes/${n.id}`} className="block px-4 py-3 hover:bg-surface-2">
                        <span className="block truncate text-sm font-medium text-ink">{n.title}</span>
                        <span className="mt-0.5 line-clamp-2 block text-[13px] text-ink-2">{n.preview}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          </div>

          <div className="min-w-0 space-y-6">
            <Panel>
              <PanelHeader title="Quiz results" />
              {data.recentAttempts.length === 0 ? (
                <p className="px-4 py-5 text-sm text-ink-2">No quizzes taken yet. Your real scores will appear here.</p>
              ) : (
                <ul className="divide-y divide-rule">
                  {data.recentAttempts.map((a) => {
                    const pct = a.maxScore ? Math.round((a.score / a.maxScore) * 100) : 0;
                    return (
                      <li key={a.id}>
                        <Link href={`/quizzes/attempts/${a.id}`} className="block px-4 py-3 hover:bg-surface-2">
                          <span className="flex items-baseline justify-between gap-2">
                            <span className="truncate text-sm font-medium text-ink">{a.quizTitle}</span>
                            <span className="shrink-0 text-sm font-semibold tabular-nums">{pct}%</span>
                          </span>
                          <span className="mt-1.5 block h-1.5 overflow-hidden rounded-full bg-black/[0.06]">
                            <span className={cx("block h-full rounded-full", pct >= 70 ? "bg-ok" : pct >= 50 ? "bg-[#d99a17]" : "bg-bad")} style={{ width: `${pct}%` }} />
                          </span>
                          <span className="mt-1 block text-xs text-ink-3">
                            {a.score} of {a.maxScore} points, {formatDate(a.createdAt)}
                          </span>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              )}
            </Panel>

            <Panel>
              <PanelHeader title="Your study so far" />
              <dl className="grid grid-cols-2 gap-px bg-rule">
                {[
                  ["Materials", data.counts.documents],
                  ["Notes", data.counts.notes],
                  ["Tutor chats", data.counts.conversations],
                  ["Quizzes taken", data.counts.attempts],
                ].map(([label, value]) => (
                  <div key={label} className="bg-surface px-4 py-3">
                    <dt className="text-xs text-ink-3">{label}</dt>
                    <dd className="text-xl font-semibold tabular-nums">{value}</dd>
                  </div>
                ))}
              </dl>
              <p className="border-t border-rule px-4 py-2.5 text-[13px] text-ink-2">
                {data.averageScore === null
                  ? "Average score appears after your first quiz."
                  : `Average of your last ${Math.min(10, data.counts.attempts)} quiz attempts: ${Math.round(data.averageScore * 100)}%`}
              </p>
            </Panel>

            <Panel>
              <PanelHeader
                title="Courses"
                action={
                  <Link href="/materials" className="text-[13px] font-medium text-action hover:underline">
                    Manage
                  </Link>
                }
              />
              {data.courses.length === 0 ? (
                <p className="px-4 py-5 text-sm text-ink-2">Create courses in Study Materials to group your materials by subject.</p>
              ) : (
                <ul className="divide-y divide-rule">
                  {data.courses.map((c) => (
                    <li key={c.id}>
                      <Link href={`/materials?course=${c.id}`} className="flex items-center justify-between px-4 py-2.5 text-sm hover:bg-surface-2">
                        <span className="truncate text-ink">{c.name}</span>
                        <span className="text-xs text-ink-3">{c.documentCount} materials</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          </div>
        </div>
      </div>
    </PageContainer>
  );
}
