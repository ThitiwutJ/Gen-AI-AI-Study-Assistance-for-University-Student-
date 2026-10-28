#!/usr/bin/env node
/**
 * Live check of your REAL local Ollama setup — run this on the laptop where Ollama runs:
 *
 *     npm run check:ai
 *
 * It lists your installed models, then sends real prompts to the chosen chat model to test
 * what Gen AI needs: a grounded English answer with a citation, a Thai answer, quiz JSON
 * through the `format` schema, and (if installed) embeddings. Nothing is downloaded.
 */
import fs from "node:fs";

// Load .env.local / .env (simple KEY=VALUE lines) so the script uses the same settings as the app.
for (const file of [".env.local", ".env"]) {
  if (!fs.existsSync(file)) continue;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

const BASE = (process.env.OLLAMA_BASE_URL || "http://127.0.0.1:11434").replace(/\/+$/, "");
const NUM_CTX = Number(process.env.OLLAMA_NUM_CTX || 8192);
const results = [];
const log = (s = "") => console.log(s);
const record = (name, status, detail) => {
  results.push({ name, status, detail });
  log(`  ${status === "PASS" ? "✔" : status === "WARN" ? "!" : "✘"} ${status}  ${name}${detail ? ` — ${detail}` : ""}`);
};

async function json(path, body, timeoutMs = 600_000) {
  const res = await fetch(`${BASE}${path}`, {
    method: body ? "POST" : "GET",
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${path} → HTTP ${res.status}: ${text.slice(0, 200)}`);
  return JSON.parse(text);
}

async function chat(model, messages, extra = {}) {
  const started = Date.now();
  const r = await json("/api/chat", { model, messages, stream: false, keep_alive: "10m", options: { num_ctx: NUM_CTX, temperature: 0.2, num_predict: 600 }, ...extra });
  const content = (r.message?.content ?? "").replace(/<think>[\s\S]*?<\/think>/g, "").trim();
  return { content, seconds: (Date.now() - started) / 1000, promptTokens: r.prompt_eval_count };
}

const sizeB = (m) => {
  const match = m.details?.parameter_size?.match(/([\d.]+)\s*([MB])/i);
  return match ? Number(match[1]) / (match[2].toUpperCase() === "M" ? 1000 : 1) : 0;
};

log(`\nGen AI — local AI check (${BASE})\n`);

let version;
try {
  version = (await json("/api/version", null, 5000)).version;
} catch {
  log("✘ Ollama isn't responding.");
  log("  Start it from the Windows Start menu (\"Ollama\"), or run `ollama serve` in a terminal, then try again.");
  process.exit(1);
}
log(`Ollama version ${version}`);

const tags = await json("/api/tags", null, 10_000);
const models = [];
for (const m of tags.models ?? []) {
  let show = {};
  try {
    show = await json("/api/show", { model: m.name }, 15_000);
  } catch {
    /* older Ollama */
  }
  const caps = show.capabilities ?? [];
  const arch = show.model_info?.["general.architecture"];
  models.push({
    name: m.name,
    caps,
    params: m.details?.parameter_size ?? "?",
    ctx: arch ? show.model_info[`${arch}.context_length`] : undefined,
    embedding: caps.includes("embedding") || (!caps.includes("completion") && caps.length > 0) || /embed|bge|minilm/i.test(m.name),
    thinking: caps.includes("thinking"),
    sizeB: sizeB(m),
  });
}
if (!models.length) {
  log("✘ No models are installed. Install one, for example: ollama pull gemma3:4b");
  process.exit(1);
}
log("\nInstalled models:");
for (const m of models) log(`  - ${m.name}  (${m.embedding ? "embedding" : "chat"}, ${m.params}${m.ctx ? `, context ${m.ctx}` : ""}${m.thinking ? ", reasoning" : ""})`);

const chatModels = models.filter((m) => !m.embedding);
const preferred = process.env.OLLAMA_MODEL;
const chatModel =
  (preferred && chatModels.find((m) => m.name === preferred || m.name === `${preferred}:latest`)) ||
  [...chatModels].filter((m) => m.sizeB >= 3 && m.sizeB <= 10).sort((a, b) => b.sizeB - a.sizeB)[0] ||
  [...chatModels].sort((a, b) => b.sizeB - a.sizeB)[0];
const embedModel = models.find((m) => m.embedding && (!process.env.OLLAMA_EMBED_MODEL || m.name.startsWith(process.env.OLLAMA_EMBED_MODEL)));

if (!chatModel) {
  log("\n✘ Only embedding models are installed. Install a chat model, for example: ollama pull gemma3:4b");
  process.exit(1);
}
log(`\nTesting chat model: ${chatModel.name} (num_ctx ${NUM_CTX})`);
log("The first request loads the model into memory and can take a while.\n");
const think = chatModel.thinking ? { think: false } : {};

// 1. Grounded English answer with a citation
try {
  const r = await chat(
    chatModel.name,
    [
      { role: "system", content: "Answer using only the SOURCES. Cite the source label in square brackets, like [S1]." },
      { role: "user", content: "SOURCES:\n[S1] FIN101 policies (p. 4)\nA late problem set loses 15% of its marks for each day it is late, and problem sets more than 3 days late receive zero marks.\n\nQUESTION:\nWhat is the late penalty for problem sets?" },
    ],
    think,
  );
  const ok = r.content.includes("15");
  const cited = /\[S1\]/i.test(r.content);
  record("Grounded English answer", ok && cited ? "PASS" : ok ? "WARN" : "FAIL", `${r.seconds.toFixed(1)} s, ${ok ? "used the source fact" : "missed the source fact"}, ${cited ? "cited [S1]" : "no [S1] citation"}`);
  log(`      “${r.content.slice(0, 220).replace(/\s+/g, " ")}${r.content.length > 220 ? "…" : ""}”`);
} catch (e) {
  record("Grounded English answer", "FAIL", e.message);
}

// 2. Thai answer
try {
  const r = await chat(
    chatModel.name,
    [
      { role: "system", content: "ตอบเป็นภาษาไทยโดยใช้ข้อมูลจาก SOURCES เท่านั้น" },
      { role: "user", content: "SOURCES:\n[S1] FIN101 บทที่ 4\nการสอบย่อยครั้งที่ 2 ของวิชา FIN101 จัดในสัปดาห์ที่ 9\n\nQUESTION:\nการสอบย่อยครั้งที่ 2 จัดในสัปดาห์ไหน" },
    ],
    think,
  );
  const thai = /[฀-๿]/.test(r.content);
  const correct = r.content.includes("9") || r.content.includes("๙");
  record("Thai answer", thai && correct ? "PASS" : thai || correct ? "WARN" : "FAIL", `${r.seconds.toFixed(1)} s, ${thai ? "answered in Thai" : "not in Thai"}, ${correct ? "correct week" : "wrong or missing week"}`);
  log(`      “${r.content.slice(0, 160).replace(/\s+/g, " ")}”`);
} catch (e) {
  record("Thai answer", "FAIL", e.message);
}

// 3. Quiz JSON through the `format` schema
try {
  const schema = {
    type: "object",
    properties: {
      questions: {
        type: "array",
        items: {
          type: "object",
          properties: { type: { type: "string", enum: ["mcq"] }, question: { type: "string" }, options: { type: "array", items: { type: "string" } }, answer: { type: "string" }, explanation: { type: "string" } },
          required: ["type", "question", "options", "answer", "explanation"],
        },
      },
    },
    required: ["questions"],
  };
  const r = await chat(
    chatModel.name,
    [
      { role: "system", content: 'Write multiple-choice questions with exactly 4 options. "answer" must be copied exactly from one of the options. Reply with JSON only.' },
      { role: "user", content: "SOURCES:\nThe future value of a single amount is FV = PV x (1 + r)^n. Compounding moves a value forward in time; discounting moves it back.\n\nWrite exactly 2 questions." },
    ],
    { ...think, format: schema, options: { num_ctx: NUM_CTX, temperature: 0.2, num_predict: 900 } },
  );
  const data = JSON.parse(r.content);
  const qs = data.questions ?? [];
  const valid = qs.filter((q) => Array.isArray(q.options) && q.options.length >= 3 && q.options.some((o) => o.trim().toLowerCase() === String(q.answer).trim().toLowerCase()));
  record("Quiz JSON (format schema)", valid.length >= 2 ? "PASS" : valid.length ? "WARN" : "FAIL", `${r.seconds.toFixed(1)} s, ${qs.length} questions returned, ${valid.length} valid`);
} catch (e) {
  record("Quiz JSON (format schema)", "FAIL", e.message);
}

// 4. Embeddings
if (embedModel) {
  try {
    const r = await json("/api/embed", { model: embedModel.name, input: ["compound interest grows money over time", "ดอกเบี้ยทบต้นทำให้เงินเติบโต", "the cat sat on the mat"] });
    const [a, b, c] = r.embeddings;
    const cos = (x, y) => x.reduce((s, v, i) => s + v * y[i], 0) / (Math.hypot(...x) * Math.hypot(...y));
    const related = cos(a, b);
    const unrelated = cos(a, c);
    record(`Embeddings (${embedModel.name})`, related > unrelated ? "PASS" : "WARN", `${a.length} dimensions; English↔Thai similarity ${related.toFixed(2)} vs unrelated ${unrelated.toFixed(2)}`);
  } catch (e) {
    record(`Embeddings (${embedModel.name})`, "FAIL", e.message);
  }
} else {
  record("Embeddings", "WARN", "no embedding model installed — Gen AI will use keyword search. Optional: ollama pull qwen3-embedding:0.6b");
}

const fails = results.filter((r) => r.status === "FAIL").length;
const warns = results.filter((r) => r.status === "WARN").length;
log(`\nSummary: ${results.length - fails - warns} passed, ${warns} warnings, ${fails} failed.`);
if (fails || warns) {
  log(
    chatModel.sizeB && chatModel.sizeB < 3
      ? `${chatModel.name} is a small model; weak results are expected. A ~4B model (e.g. \`ollama pull gemma3:4b\`) usually fixes them if your laptop has 8 GB+ RAM.`
      : "Check the details above. See docs/TROUBLESHOOTING.md.",
  );
}
process.exit(fails ? 2 : 0);
