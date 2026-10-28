"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { FileStack, ListChecks, MessagesSquare, NotebookPen, Search } from "lucide-react";
import { PageContainer } from "@/components/shell/AppShell";
import { EmptyState, ErrorNotice, Input, PageHeader, Panel, Segmented, Select, Spinner, formatDate } from "@/components/ui";
import { useApi } from "@/hooks/api";
import type { Course, LibraryItem } from "@/lib/types";

const ICONS = { document: FileStack, note: NotebookPen, quiz: ListChecks, conversation: MessagesSquare } as const;
const LABELS = { document: "Material", note: "Note", quiz: "Quiz", conversation: "Tutor chat" } as const;

type TypeFilter = "all" | "document" | "note" | "quiz" | "conversation";

export default function LibraryPage() {
  const [q, setQ] = useState("");
  const [debounced, setDebounced] = useState("");
  const [type, setType] = useState<TypeFilter>("all");
  const [course, setCourse] = useState("");
  const courses = useApi<Course[]>("/api/courses");

  useEffect(() => {
    const t = setTimeout(() => setDebounced(q), 250);
    return () => clearTimeout(t);
  }, [q]);

  const params = new URLSearchParams();
  if (debounced.trim()) params.set("q", debounced.trim());
  if (type !== "all") params.set("type", type);
  if (course) params.set("courseId", course);
  const items = useApi<LibraryItem[]>(`/api/library?${params.toString()}`);

  return (
    <PageContainer>
      <PageHeader title="Study library" description="Everything you've saved in one place: materials, notes, quizzes and tutor conversations." />

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="relative min-w-[220px] flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-ink-3" aria-hidden />
          <Input className="pl-8" placeholder="Search titles and content" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search the library" />
        </div>
        <Select aria-label="Course" className="!w-auto" value={course} onChange={(e) => setCourse(e.target.value)}>
          <option value="">All courses</option>
          {courses.data?.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Select>
      </div>
      <div className="mb-4 overflow-x-auto">
        <Segmented
          label="Type"
          value={type}
          onChange={setType}
          options={[
            { value: "all", label: "Everything" },
            { value: "document", label: "Materials" },
            { value: "note", label: "Notes" },
            { value: "quiz", label: "Quizzes" },
            { value: "conversation", label: "Tutor chats" },
          ]}
        />
      </div>

      <Panel>
        {items.error && (
          <div className="p-4">
            <ErrorNotice error={items.error} onRetry={items.reload} />
          </div>
        )}
        {items.loading && !items.data ? (
          <div className="flex items-center gap-2 p-4 text-sm text-ink-2">
            <Spinner /> Loading…
          </div>
        ) : !items.data?.length ? (
          <EmptyState icon={<Search className="size-7" />} title={debounced || type !== "all" || course ? "Nothing matches these filters" : "Your library is empty"}>
            {debounced || type !== "all" || course ? "Try other words or filters." : "Upload a material to get started."}
          </EmptyState>
        ) : (
          <ul className="divide-y divide-rule">
            {items.data.map((item) => {
              const Icon = ICONS[item.type];
              return (
                <li key={`${item.type}-${item.id}`}>
                  <Link href={item.href} className="group flex items-start gap-3 px-4 py-3 hover:bg-surface-2">
                    <Icon className="mt-0.5 size-4 shrink-0 text-ink-3" aria-hidden />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-ink group-hover:text-action">{item.title}</span>
                      {item.snippet && <span className="mt-0.5 line-clamp-1 block text-[13px] text-ink-2">{item.snippet}</span>}
                      <span className="mt-0.5 block text-xs text-ink-3">
                        {LABELS[item.type]}
                        {item.courseName ? `, ${item.courseName}` : ""}, {formatDate(item.updatedAt)}
                      </span>
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
