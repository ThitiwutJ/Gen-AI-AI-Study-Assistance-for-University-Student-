"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { JobView } from "@/lib/types";

export class ApiError extends Error {
  constructor(
    public code: string,
    message: string,
    public fix?: string,
    public status = 0,
  ) {
    super(message);
  }
}

export async function api<T>(url: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  const { json, ...rest } = init ?? {};
  let res: Response;
  try {
    res = await fetch(url, {
      ...rest,
      headers: json !== undefined ? { "content-type": "application/json", ...(rest.headers ?? {}) } : rest.headers,
      body: json !== undefined ? JSON.stringify(json) : rest.body,
    });
  } catch {
    throw new ApiError("network", "Can't reach the Gen AI server. Is `npm run dev` (or `npm start`) still running?");
  }
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    /* not JSON */
  }
  if (!res.ok) {
    const err = (data as { error?: { code?: string; message?: string; fix?: string } } | null)?.error;
    throw new ApiError(err?.code ?? "http_error", err?.message ?? `Request failed (${res.status}).`, err?.fix, res.status);
  }
  return data as T;
}

/** Load JSON from an API route, with reload. */
export function useApi<T>(url: string | null) {
  const [state, setState] = useState<{ url: string | null; data: T | null; error: ApiError | null; loading: boolean }>({
    url,
    data: null,
    error: null,
    loading: Boolean(url),
  });
  // Reset when the URL changes (adjusting state during render, as React recommends).
  if (state.url !== url) setState({ url, data: null, error: null, loading: Boolean(url) });

  const load = useCallback(async (target: string) => {
    try {
      const result = await api<T>(target);
      setState((s) => (s.url === target ? { ...s, data: result, error: null, loading: false } : s));
    } catch (e) {
      const err = e instanceof ApiError ? e : new ApiError("unknown", String(e));
      setState((s) => (s.url === target ? { ...s, error: err, loading: false } : s));
    }
  }, []);

  useEffect(() => {
    if (!url) return;
    const t = setTimeout(() => void load(url), 0);
    return () => clearTimeout(t);
  }, [url, load]);

  const reload = useCallback(async () => {
    if (!url) return;
    setState((s) => ({ ...s, loading: true }));
    await load(url);
  }, [url, load]);

  const setData = useCallback((data: T | null) => setState((s) => ({ ...s, data })), []);

  return { data: state.data, error: state.error, loading: state.loading, reload, setData };
}

/** Poll a background job until it finishes. */
export function useJob<T>(jobId: string | null, onFinish?: (job: JobView<T>) => void) {
  const [state, setState] = useState<{ id: string | null; job: JobView<T> | null }>({ id: jobId, job: null });
  if (state.id !== jobId) setState({ id: jobId, job: null });
  const finishRef = useRef(onFinish);
  useEffect(() => {
    finishRef.current = onFinish;
  });

  useEffect(() => {
    if (!jobId) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      try {
        const j = await api<JobView<T>>(`/api/jobs/${jobId}`);
        if (stopped) return;
        setState({ id: jobId, job: j });
        if (j.status !== "running") {
          finishRef.current?.(j);
          return;
        }
      } catch (e) {
        if (stopped) return;
        const err = e instanceof ApiError ? e : new ApiError("unknown", String(e));
        const failed: JobView<T> = {
          id: jobId,
          kind: "unknown",
          status: "error",
          stage: "error",
          progress: null,
          partial: null,
          tokens: 0,
          result: null,
          error: { code: err.code, message: err.message, fix: err.fix },
          startedAt: new Date().toISOString(),
        };
        setState({ id: jobId, job: failed });
        finishRef.current?.(failed);
        return;
      }
      timer = setTimeout(tick, 600);
    };
    timer = setTimeout(tick, 0);
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [jobId]);

  const cancel = useCallback(async () => {
    if (jobId) await api(`/api/jobs/${jobId}`, { method: "DELETE" }).catch(() => undefined);
  }, [jobId]);

  return { job: state.id === jobId ? state.job : null, cancel };
}
