"use client";

import { useState } from "react";
import { Check, Copy, RefreshCw, Zap } from "lucide-react";
import { describeStatus } from "@/components/shell/StatusPill";
import { useAIStatus, useToast } from "@/components/shell/providers";
import { PageContainer } from "@/components/shell/AppShell";
import { Badge, Button, ErrorNotice, Field, Input, PageHeader, Panel, PanelHeader, Select, cx, formatBytes, renderInlineCode } from "@/components/ui";
import { api, ApiError, useApi } from "@/hooks/api";
import type { SettingsView } from "@/lib/types";

const CTX_OPTIONS = [4096, 8192, 16384, 32768, 65536];

function CopyCommand({ command }: { command: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex items-center gap-2 rounded-md border border-rule bg-surface-2 py-1 pl-3 pr-1">
      <code className="flex-1 overflow-x-auto whitespace-nowrap font-mono text-[13px] text-ink">{command}</code>
      <button
        className="inline-flex size-7 items-center justify-center rounded text-ink-3 hover:bg-black/[0.05] hover:text-ink"
        aria-label={`Copy ${command}`}
        onClick={() =>
          void navigator.clipboard.writeText(command).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          })
        }
      >
        {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
      </button>
    </div>
  );
}

export default function SettingsPage() {
  const toast = useToast();
  const { status, refresh, checking } = useAIStatus();
  const settings = useApi<SettingsView>("/api/settings");
  const [form, setForm] = useState<SettingsView | null>(null);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [test, setTest] = useState<{ reply: string; ms: number; model: string } | null>(null);
  const [testError, setTestError] = useState<{ message: string; fix?: string } | null>(null);
  const [reindexing, setReindexing] = useState(false);

  const [syncedFrom, setSyncedFrom] = useState<SettingsView | null>(null);
  if (settings.data && settings.data !== syncedFrom) {
    setSyncedFrom(settings.data);
    setForm(settings.data);
  }

  const d = describeStatus(status, null);
  const chatModels = status?.models.filter((m) => !m.isEmbedding) ?? [];
  const embedModels = status?.models.filter((m) => m.isEmbedding) ?? [];
  const maxCtx = status?.chat.contextLength ?? null;

  async function save(patch: Partial<SettingsView>, message: string) {
    setSaving(true);
    try {
      const saved = await api<SettingsView>("/api/settings", { method: "PUT", json: patch });
      settings.setData(saved);
      await refresh(true);
      toast(message);
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), "bad");
    } finally {
      setSaving(false);
    }
  }

  async function runTest() {
    setTesting(true);
    setTest(null);
    setTestError(null);
    try {
      setTest(await api<{ reply: string; ms: number; model: string }>("/api/ai/test", { method: "POST" }));
    } catch (e) {
      const err = e instanceof ApiError ? e : new ApiError("unknown", String(e));
      setTestError({ message: err.message, fix: err.fix });
    } finally {
      setTesting(false);
      void refresh(true);
    }
  }

  async function reindex() {
    setReindexing(true);
    try {
      const r = await api<{ queued: number }>("/api/documents/reindex", { method: "POST", json: {} });
      toast(r.queued ? `Re-indexing ${r.queued} material${r.queued > 1 ? "s" : ""}.` : "Everything is already indexed.");
      await refresh(true);
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), "bad");
    } finally {
      setReindexing(false);
    }
  }

  return (
    <PageContainer>
      <PageHeader title="Settings" description="Gen AI uses an AI model running on this computer through Ollama. No paid API key is needed and your materials never leave this computer." />

      <div className="space-y-6">
        <Panel>
          <PanelHeader
            title="Local AI connection"
            action={
              <Button size="sm" icon={<RefreshCw className={cx("size-3.5", checking && "animate-spin")} />} onClick={() => void refresh(true)}>
                Check again
              </Button>
            }
          />
          <div className="space-y-4 p-4">
            <div className="flex flex-wrap items-center gap-3">
              <Badge tone={d.tone === "ok" ? "ok" : d.tone === "warn" ? "warn" : d.tone === "bad" ? "bad" : "neutral"}>{d.label}</Badge>
              <span className="text-sm text-ink-2">
                {status?.provider === "openai-compatible" ? "OpenAI-compatible server" : "Ollama"} at <code className="font-mono text-[13px]">{status?.baseUrl ?? "…"}</code>
                {status?.version && `, version ${status.version}`}
              </span>
            </div>

            {status?.problems.map((p) => (
              <div key={p.code} className={cx("rounded-md border px-3 py-2.5 text-sm", p.code === "no_embed_model" ? "border-rule bg-surface-2" : "border-warn/30 bg-warn-soft")}>
                <p className="font-medium text-ink">{p.message}</p>
                {p.fix && <p className="mt-0.5 text-ink-2">{renderInlineCode(p.fix)}</p>}
              </div>
            ))}

            {status && status.models.length > 0 && (
              <div>
                <p className="mb-2 text-[13px] font-medium text-ink-2">Installed models</p>
                <ul className="divide-y divide-rule rounded-md border border-rule">
                  {status.models.map((m) => (
                    <li key={m.name} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm">
                      <code className="font-mono text-[13px] text-ink">{m.name}</code>
                      <Badge tone={m.isEmbedding ? "neutral" : "action"}>{m.isEmbedding ? "Embedding" : "Chat"}</Badge>
                      {m.thinking && <Badge>Reasoning</Badge>}
                      {status.loadedModels.includes(m.name) && <Badge tone="ok">Loaded</Badge>}
                      <span className="ml-auto text-xs text-ink-3">
                        {[m.parameterSize, formatBytes(m.sizeBytes), m.contextLength ? `${m.contextLength.toLocaleString()} token context` : null].filter(Boolean).join(", ")}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="flex flex-wrap items-center gap-3">
              <Button variant="primary" icon={<Zap className="size-4" />} busy={testing} disabled={status?.state !== "connected"} onClick={() => void runTest()}>
                Test the model
              </Button>
              <span className="text-[13px] text-ink-3">Sends a one-line prompt to the selected chat model and times the reply.</span>
            </div>
            {test && (
              <div className="rounded-md border border-ok/30 bg-ok-soft px-3 py-2.5 text-sm">
                <p className="font-medium text-ink">
                  {test.model} replied in {(test.ms / 1000).toFixed(1)} s
                </p>
                <p className="mt-0.5 text-ink-2">“{test.reply}”</p>
              </div>
            )}
            <ErrorNotice error={testError} compact />
          </div>
        </Panel>

        {form && (
          <Panel>
            <PanelHeader title="Models" description="Choose which installed models Gen AI uses. Changes apply to the next request." />
            <div className="grid gap-5 p-4 md:grid-cols-2">
              <Field
                label="Chat model"
                htmlFor="chat-model"
                hint={form.chatModel ? "Used for answers, notes, quizzes and grading." : `Automatic: currently ${status?.chat.model ?? "none available"}. Prefers a 3–10B model when installed.`}
              >
                <Select id="chat-model" value={form.chatModel} onChange={(e) => void save({ chatModel: e.target.value }, "Chat model saved.")} disabled={saving}>
                  <option value="">Automatic</option>
                  {chatModels.map((m) => (
                    <option key={m.name} value={m.name}>
                      {m.name}
                      {m.parameterSize ? ` (${m.parameterSize})` : ""}
                    </option>
                  ))}
                  {form.chatModel && !chatModels.some((m) => m.name === form.chatModel) && <option value={form.chatModel}>{form.chatModel} (not installed)</option>}
                </Select>
              </Field>
              <Field
                label="Embedding model (semantic search)"
                htmlFor="embed-model"
                hint={
                  form.embedModel === "none"
                    ? "Off: materials are searched by keywords only."
                    : embedModels.length
                      ? `Automatic picks a multilingual model when one is installed. Currently: ${status?.embed.model ?? "none"}.`
                      : "None installed, so search uses keywords only. See the setup guide below."
                }
              >
                <Select id="embed-model" value={form.embedModel} onChange={(e) => void save({ embedModel: e.target.value }, "Embedding model saved.")} disabled={saving}>
                  <option value="">Automatic</option>
                  <option value="none">Off (keyword search only)</option>
                  {embedModels.map((m) => (
                    <option key={m.name} value={m.name}>
                      {m.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field
                label="Context window (num_ctx)"
                htmlFor="num-ctx"
                hint="How much text the model reads at once: your question, the retrieved passages and recent chat. Larger fits more but needs more memory and runs slower. 8,192 suits most laptops."
              >
                <Select id="num-ctx" value={form.numCtx} onChange={(e) => void save({ numCtx: Number(e.target.value) }, "Context window saved.")} disabled={saving}>
                  {CTX_OPTIONS.map((n) => (
                    <option key={n} value={n} disabled={maxCtx !== null && n > maxCtx}>
                      {n.toLocaleString()} tokens{maxCtx !== null && n > maxCtx ? " (more than this model supports)" : ""}
                    </option>
                  ))}
                </Select>
              </Field>
              <div className="space-y-1.5">
                <p className="text-[13px] font-medium text-ink-2">Search index</p>
                <p className="text-sm text-ink-2">
                  {status?.staleDocuments
                    ? `${status.staleDocuments} material${status.staleDocuments > 1 ? "s need" : " needs"} indexing with the current embedding model.`
                    : "All materials are indexed with the current settings."}
                </p>
                <Button size="sm" icon={<RefreshCw className="size-3.5" />} busy={reindexing} onClick={() => void reindex()}>
                  Re-index documents
                </Button>
              </div>
            </div>
          </Panel>
        )}

        {form && (
          <Panel>
            <PanelHeader title="Profile" />
            <form
              className="flex flex-wrap items-end gap-3 p-4"
              onSubmit={(e) => {
                e.preventDefault();
                void save({ displayName: form.displayName }, "Name saved.");
              }}
            >
              <div className="w-full max-w-xs">
                <Field label="Your name (shown on the dashboard)" htmlFor="display-name">
                  <Input id="display-name" maxLength={40} value={form.displayName} onChange={(e) => setForm({ ...form, displayName: e.target.value })} />
                </Field>
              </div>
              <Button type="submit" busy={saving}>
                Save name
              </Button>
            </form>
          </Panel>
        )}

        <Panel>
          <PanelHeader title="Setup guide" description="For Windows. On macOS or Linux the commands are the same in Terminal." />
          <ol className="space-y-5 p-4 text-sm text-ink-2">
            <li>
              <p className="font-medium text-ink">1. Start Ollama</p>
              <p className="mt-1">Open “Ollama” from the Start menu; it runs in the system tray. Or run this in a terminal and keep it open:</p>
              <div className="mt-2 max-w-md">
                <CopyCommand command="ollama serve" />
              </div>
            </li>
            <li>
              <p className="font-medium text-ink">2. See which models are installed</p>
              <div className="mt-2 max-w-md">
                <CopyCommand command="ollama list" />
              </div>
            </li>
            <li>
              <p className="font-medium text-ink">3. Optional: install better models</p>
              <p className="mt-1">
                Small models (around 1B parameters) are fast but weaker at long explanations, Thai, and quiz generation. If your laptop has 8 GB of RAM or more, a 4B model is a good step up. A
                multilingual embedding model turns on semantic search for English and Thai. Check sizes on ollama.com before downloading.
              </p>
              <div className="mt-2 grid max-w-xl gap-2">
                <CopyCommand command="ollama pull gemma3:4b" />
                <CopyCommand command="ollama pull qwen3-embedding:0.6b" />
              </div>
              <p className="mt-2 text-xs text-ink-3">Then click “Check again” above. Gen AI never downloads models by itself.</p>
            </li>
            <li>
              <p className="font-medium text-ink">Where your data is stored</p>
              <p className="mt-1">
                Everything (materials, extracted text, search index, notes, chats and quiz results) is saved in the <code className="font-mono">data</code> folder inside the Gen AI project on this
                computer. There are no accounts and no cloud sync. Delete that folder to reset the app.
              </p>
            </li>
          </ol>
        </Panel>
      </div>
    </PageContainer>
  );
}
