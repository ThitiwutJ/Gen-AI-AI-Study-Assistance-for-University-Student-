import { randomUUID } from "node:crypto";
import { AppError, toErrorBody } from "@/lib/errors";
import type { JobView } from "@/lib/types";

/**
 * Long AI tasks (answers, summaries, quizzes, grading) run as in-process jobs.
 * The browser polls a job to show real progress — stage, token count, partial text —
 * and can cancel it. Jobs live in memory; their results are saved to SQLite by the task itself.
 */

export interface JobContext {
  signal: AbortSignal;
  setStage(stage: string): void;
  setProgress(done: number, total: number): void;
  setPartial(text: string, tokens: number): void;
}

interface Job extends JobView {
  controller: AbortController;
  finishedAt?: number;
}

const g = globalThis as typeof globalThis & { __genaiJobs?: Map<string, Job> };
const jobs: Map<string, Job> = (g.__genaiJobs ??= new Map());

function sweep() {
  const cutoff = Date.now() - 30 * 60_000;
  for (const [id, job] of jobs) {
    if (job.finishedAt && job.finishedAt < cutoff) jobs.delete(id);
  }
}

export function startJob<T>(kind: string, run: (ctx: JobContext) => Promise<T>): JobView<T> {
  sweep();
  const controller = new AbortController();
  const job: Job = {
    id: randomUUID(),
    kind,
    status: "running",
    stage: "starting",
    progress: null,
    partial: null,
    tokens: 0,
    result: null,
    error: null,
    startedAt: new Date().toISOString(),
    controller,
  };
  jobs.set(job.id, job);

  const ctx: JobContext = {
    signal: controller.signal,
    setStage: (stage) => {
      job.stage = stage;
    },
    setProgress: (done, total) => {
      job.progress = { done, total };
    },
    setPartial: (text, tokens) => {
      job.partial = text;
      job.tokens = tokens;
      job.stage = "generating";
    },
  };

  void (async () => {
    try {
      const result = await run(ctx);
      if (controller.signal.aborted) {
        job.status = "cancelled";
      } else {
        job.result = result;
        job.status = "done";
        job.stage = "done";
      }
    } catch (error) {
      if (controller.signal.aborted || (error instanceof AppError && error.code === "cancelled")) {
        job.status = "cancelled";
        job.error = { code: "cancelled", message: "Cancelled." };
      } else {
        job.status = "error";
        job.error = toErrorBody(error).body.error;
      }
    } finally {
      job.finishedAt = Date.now();
      job.partial = job.status === "done" ? null : job.partial;
    }
  })();

  return view(job) as JobView<T>;
}

function view(job: Job): JobView {
  const { controller: _c, finishedAt: _f, ...rest } = job;
  void _c;
  void _f;
  return { ...rest };
}

export function getJob(id: string): JobView | null {
  const job = jobs.get(id);
  return job ? view(job) : null;
}

export function cancelJob(id: string): boolean {
  const job = jobs.get(id);
  if (!job || job.status !== "running") return false;
  job.controller.abort();
  return true;
}

/** Wait for a job to finish (used by tests and scripts). */
export async function waitForJob(id: string, timeoutMs = 120_000): Promise<JobView> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const job = getJob(id);
    if (!job) throw new Error("job not found");
    if (job.status !== "running") return job;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error("timed out waiting for job");
}
