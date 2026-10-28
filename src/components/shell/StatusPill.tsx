"use client";

import Link from "next/link";
import { cx } from "@/components/ui";
import type { AIStatus } from "@/lib/types";
import { useAIStatus, type Activity } from "./providers";

export function describeStatus(status: AIStatus | null, activity: Activity): { label: string; tone: "ok" | "warn" | "bad" | "busy" | "idle"; detail: string } {
  if (activity === "loading_model") return { label: "Model loading", tone: "busy", detail: "Starting the local model…" };
  if (activity === "generating") return { label: "Generating", tone: "busy", detail: status?.chat.model ?? "" };
  if (!status) return { label: "Checking…", tone: "idle", detail: "Local AI" };
  switch (status.state) {
    case "connected":
      return {
        label: "Connected",
        tone: status.embed.available ? "ok" : "warn",
        detail: `${status.chat.model ?? ""}${status.embed.available ? "" : " (keyword search)"}`,
      };
    case "not_running":
      return { label: "Not running", tone: "bad", detail: status.provider === "ollama" ? "Start Ollama" : "AI server offline" };
    case "model_unavailable":
      return { label: "Model unavailable", tone: "bad", detail: status.chat.model ?? "" };
    case "no_models":
      return { label: "No chat model", tone: "bad", detail: "Install a model" };
    default:
      return { label: "Error", tone: "bad", detail: status.problems[0]?.message ?? "" };
  }
}

const DOT: Record<string, string> = {
  ok: "bg-ok",
  warn: "bg-[#d99a17]",
  bad: "bg-bad",
  busy: "bg-action animate-pulse",
  idle: "bg-ink-3",
};

export function StatusPill() {
  const { status, activity } = useAIStatus();
  const d = describeStatus(status, activity);
  return (
    <Link
      href="/settings"
      className="flex items-center gap-2.5 rounded-md border border-rule bg-surface-2 px-2.5 py-2 text-left hover:border-rule-strong"
      aria-label={`Local AI status: ${d.label}. Open settings.`}
    >
      <span className={cx("size-2 shrink-0 rounded-full", DOT[d.tone])} aria-hidden />
      <span className="min-w-0 leading-tight">
        <span className="block text-[13px] font-medium text-ink">{d.label}</span>
        <span className="block truncate text-[11.5px] text-ink-3">{d.detail}</span>
      </span>
    </Link>
  );
}
