"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { CheckCircle2, AlertTriangle, X } from "lucide-react";
import { api } from "@/hooks/api";
import type { AIStatus } from "@/lib/types";
import { cx } from "@/components/ui";

// ---------- AI status ----------

export type Activity = "loading_model" | "generating" | "error" | null;

interface StatusContextValue {
  status: AIStatus | null;
  checking: boolean;
  refresh: (force?: boolean) => Promise<AIStatus | null>;
  activity: Activity;
  setActivity: (a: Activity) => void;
}

const StatusContext = createContext<StatusContextValue | null>(null);

export function AIStatusProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AIStatus | null>(null);
  const [checking, setChecking] = useState(false);
  const [activity, setActivity] = useState<Activity>(null);

  const refresh = useCallback(async (force = false) => {
    setChecking(true);
    try {
      const s = await api<AIStatus>(`/api/ai/status${force ? "?force=1" : ""}`);
      setStatus(s);
      return s;
    } catch {
      return null;
    } finally {
      setChecking(false);
    }
  }, []);

  useEffect(() => {
    const first = setTimeout(() => void refresh(), 0);
    const timer = setInterval(() => void refresh(), 20_000);
    const onFocus = () => void refresh();
    window.addEventListener("focus", onFocus);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
      window.removeEventListener("focus", onFocus);
    };
  }, [refresh]);

  const value = useMemo(() => ({ status, checking, refresh, activity, setActivity }), [status, checking, refresh, activity]);
  return <StatusContext.Provider value={value}>{children}</StatusContext.Provider>;
}

export function useAIStatus(): StatusContextValue {
  const ctx = useContext(StatusContext);
  if (!ctx) throw new Error("useAIStatus must be used inside AIStatusProvider");
  return ctx;
}

// ---------- Toasts ----------

interface Toast {
  id: number;
  tone: "ok" | "bad";
  text: string;
}

const ToastContext = createContext<(text: string, tone?: "ok" | "bad") => void>(() => undefined);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const next = useRef(1);
  const push = useCallback((text: string, tone: "ok" | "bad" = "ok") => {
    const id = next.current++;
    setToasts((t) => [...t, { id, tone, text }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), tone === "bad" ? 7000 : 3500);
  }, []);
  return (
    <ToastContext.Provider value={push}>
      {children}
      <div aria-live="polite" className="pointer-events-none fixed bottom-4 right-4 z-50 flex w-[min(380px,calc(100%-32px))] flex-col gap-2">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={cx(
              "pointer-events-auto flex items-start gap-2.5 rounded-md border bg-surface px-3.5 py-2.5 text-sm shadow-[0_8px_24px_-8px_rgba(16,24,40,0.25)]",
              t.tone === "ok" ? "border-ok/30" : "border-bad/30",
            )}
          >
            {t.tone === "ok" ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-ok" /> : <AlertTriangle className="mt-0.5 size-4 shrink-0 text-bad" />}
            <span className="flex-1 text-ink">{t.text}</span>
            <button aria-label="Dismiss" className="text-ink-3 hover:text-ink" onClick={() => setToasts((all) => all.filter((x) => x.id !== t.id))}>
              <X className="size-4" />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  return useContext(ToastContext);
}
