/**
 * Helpers shared by scripts/launch.mjs and scripts/check-ollama.mjs:
 * load .env files, talk to Ollama, detect a model that crashes on the GPU, and start a
 * private CPU-only Ollama (on another port) as a fallback. Nothing here changes system settings:
 * the CPU-only Ollama only runs while Gen AI is running.
 */
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

export function loadEnvFiles(dir = process.cwd()) {
  for (const file of [".env.local", ".env"]) {
    const full = path.join(dir, file);
    if (!fs.existsSync(full)) continue;
    for (const line of fs.readFileSync(full, "utf8").split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  }
}

export const DEFAULT_BASE = "http://127.0.0.1:11434";
export const CPU_PORT = Number(process.env.GENAI_CPU_OLLAMA_PORT || 11435);
export const CPU_BASE = `http://127.0.0.1:${CPU_PORT}`;

export async function ollamaJson(base, pathname, body, timeoutMs = 10_000) {
  const res = await fetch(`${base}${pathname}`, {
    method: body ? "POST" : "GET",
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await res.text();
  if (!res.ok) {
    let message = text;
    try {
      message = JSON.parse(text).error ?? text;
    } catch {
      /* not JSON */
    }
    const error = new Error(String(message).slice(0, 400));
    error.status = res.status;
    throw error;
  }
  return JSON.parse(text);
}

export async function isUp(base, timeoutMs = 2500) {
  try {
    await ollamaJson(base, "/api/version", null, timeoutMs);
    return true;
  } catch {
    return false;
  }
}

export async function waitUntilUp(base, seconds) {
  for (let i = 0; i < seconds * 2; i++) {
    if (await isUp(base, 1500)) return true;
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

/** Errors that mean the model process crashed (typically a GPU driver / CUDA problem). */
export function isCrashError(message) {
  return /llama-server process has terminated|runner process has terminated|CUDA error|exit status 0x|0xc0000409|device kernel image is invalid|unable to load model/i.test(String(message));
}

/** Try to start the user's normal Ollama if it isn't running. */
export function startOllamaApp() {
  const app = process.platform === "win32" && process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, "Programs", "Ollama", "ollama app.exe") : null;
  try {
    if (app && fs.existsSync(app)) {
      spawn(app, [], { detached: true, stdio: "ignore" }).unref();
    } else {
      spawn("ollama", ["serve"], { detached: true, stdio: "ignore", windowsHide: true }).unref();
    }
    return true;
  } catch {
    return false;
  }
}

/** Installed models with capabilities (embedding vs chat). */
export async function listModels(base) {
  const tags = await ollamaJson(base, "/api/tags", null, 10_000);
  const out = [];
  for (const m of tags.models ?? []) {
    let caps = [];
    try {
      caps = (await ollamaJson(base, "/api/show", { model: m.name }, 15_000)).capabilities ?? [];
    } catch {
      /* older Ollama */
    }
    const embedding = caps.includes("embedding") || (caps.length > 0 && !caps.includes("completion")) || (caps.length === 0 && /embed|bge|minilm/i.test(m.name));
    out.push({ name: m.name, size: m.size ?? 0, embedding, details: m.details ?? {} });
  }
  return out;
}

/** Load the model with a 1-token request. Returns { ok, error }. */
export async function probeModel(base, model, numCtx) {
  try {
    await ollamaJson(
      base,
      "/api/generate",
      { model, prompt: "Hi", stream: false, keep_alive: "10m", options: { num_predict: 1, ...(numCtx ? { num_ctx: numCtx } : {}) } },
      240_000,
    );
    return { ok: true, error: null };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * Start a private Ollama that only uses the CPU, on CPU_PORT. It shares your installed models
 * (no re-download) and stops when the parent process stops.
 */
export function startCpuOllama(logFile) {
  const env = {
    ...process.env,
    OLLAMA_HOST: `127.0.0.1:${CPU_PORT}`,
    CUDA_VISIBLE_DEVICES: "-1",
    HIP_VISIBLE_DEVICES: "-1",
    ROCR_VISIBLE_DEVICES: "-1",
    GGML_VK_VISIBLE_DEVICES: "-1",
    OLLAMA_VULKAN: "0",
  };
  let out = "ignore";
  if (logFile) {
    fs.mkdirSync(path.dirname(logFile), { recursive: true });
    out = fs.openSync(logFile, "a");
  }
  const child = spawn("ollama", ["serve"], { env, stdio: ["ignore", out, out], windowsHide: true });
  child.on("error", () => undefined);
  return child;
}
