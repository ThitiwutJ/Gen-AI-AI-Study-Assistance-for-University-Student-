import { AppError } from "@/lib/errors";
import { handle } from "@/lib/http";
import { cancelJob, getJob } from "@/lib/jobs";

export const dynamic = "force-dynamic";

export const GET = handle(async (_request: Request, ctx: RouteContext<"/api/jobs/[id]">) => {
  const { id } = await ctx.params;
  const job = getJob(id);
  if (!job) throw new AppError("job_not_found", "This task is no longer running (the server may have restarted). Please try again.", 404);
  return job;
});

export const DELETE = handle(async (_request: Request, ctx: RouteContext<"/api/jobs/[id]">) => {
  const { id } = await ctx.params;
  return { cancelled: cancelJob(id) };
});
