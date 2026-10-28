import { z } from "zod";
import { invalidateStatus } from "@/lib/ai/service";
import { handle, readJson, zLanguage } from "@/lib/http";
import { getSettings, saveSettings } from "@/lib/settings";

export const dynamic = "force-dynamic";

export const GET = handle(async () => getSettings());

const Patch = z.object({
  displayName: z.string().max(40).optional(),
  chatModel: z.string().max(200).optional(),
  embedModel: z.string().max(200).optional(),
  numCtx: z.number().int().min(2048).max(262144).optional(),
  defaultLanguage: zLanguage.optional(),
});

export const PUT = handle(async (request: Request) => {
  const patch = await readJson(request, Patch);
  const saved = saveSettings({ ...patch, displayName: patch.displayName?.trim() });
  invalidateStatus();
  return saved;
});
