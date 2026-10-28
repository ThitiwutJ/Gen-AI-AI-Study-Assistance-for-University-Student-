import { getStatus } from "@/lib/ai/service";
import { handle } from "@/lib/http";
import { syncIndexState } from "@/lib/retrieval/indexer";

export const dynamic = "force-dynamic";

export const GET = handle(async (request: Request) => {
  const force = new URL(request.url).searchParams.get("force") === "1";
  const status = await getStatus(force);
  if (status.state !== "not_running") syncIndexState(status.embed.available ? status.embed.model : null);
  return status;
});
