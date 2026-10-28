#!/usr/bin/env node
/**
 * Starts Gen AI (`npm start`, `npm run dev`, `npm run start:lan`).
 *
 * Before starting the web app it checks the local Ollama:
 *  1. If Ollama isn't running, it tries to start it.
 *  2. It loads a chat model once. If loading crashes (common when the graphics driver is too old
 *     for the installed Ollama — "CUDA error", "llama-server process has terminated"), it starts a
 *     private CPU-only Ollama on port 11435 and points Gen AI at it. Your normal Ollama and system
 *     settings are not changed; the CPU-only Ollama stops when Gen AI stops.
 *
 * Flags: --dev (next dev), --lan (listen on the network), --open (open the browser),
 *        --no-fallback (never start the CPU-only Ollama)
 */
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import {
  CPU_BASE,
  DEFAULT_BASE,
  isCrashError,
  isUp,
  listModels,
  loadEnvFiles,
  probeModel,
  startCpuOllama,
  startOllamaApp,
  waitUntilUp,
} from "./ollama-local.mjs";

const args = new Set(process.argv.slice(2));
const dev = args.has("--dev");
const lan = args.has("--lan");
const open = args.has("--open");
const fallbackAllowed = !args.has("--no-fallback") && process.env.GENAI_CPU_FALLBACK !== "0";

loadEnvFiles();
const log = (msg) => console.log(`[gen-ai] ${msg}`);
const base = (process.env.OLLAMA_BASE_URL || DEFAULT_BASE).replace(/\/+$/, "");
const numCtx = Number(process.env.OLLAMA_NUM_CTX || 8192);
const dataDir = path.resolve(process.env.DATA_DIR || "data");
let cpuOllama = null;
let useBase = base;

async function prepareOllama() {
  if (process.env.AI_PROVIDER === "openai-compatible") return;
  if (!(await isUp(base))) {
    log(`Ollama isn't responding at ${base}. Trying to start it...`);
    startOllamaApp();
    if (!(await waitUntilUp(base, 20))) {
      log("Ollama still isn't running. Gen AI will start anyway; open Settings in the app for help.");
      return;
    }
  }
  let models;
  try {
    models = (await listModels(base)).filter((m) => !m.embedding);
  } catch (error) {
    log(`Couldn't list Ollama models: ${error.message}`);
    return;
  }
  if (!models.length) {
    log("No chat model is installed in Ollama. Gen AI will start; see Settings for how to install one.");
    return;
  }
  const preferred = process.env.OLLAMA_MODEL && models.find((m) => m.name === process.env.OLLAMA_MODEL || m.name === `${process.env.OLLAMA_MODEL}:latest`);
  const probe = preferred || [...models].sort((a, b) => a.size - b.size)[0];
  log(`Checking that Ollama can load ${probe.name}...`);
  const first = await probeModel(base, probe.name, numCtx);
  if (first.ok) {
    log(`Ollama is working (${base}).`);
    return;
  }
  log(`Ollama couldn't load ${probe.name}: ${first.error.slice(0, 160)}`);
  if (!isCrashError(first.error) || !fallbackAllowed) return;

  log("This is usually a graphics-driver problem. Starting a CPU-only Ollama for Gen AI instead...");
  log("(Updating your graphics driver lets Ollama use the GPU again, which is faster.)");
  if (await isUp(CPU_BASE)) {
    log(`A CPU-only Ollama is already running at ${CPU_BASE}.`);
  } else {
    cpuOllama = startCpuOllama(path.join(dataDir, "ollama-cpu.log"));
    if (!(await waitUntilUp(CPU_BASE, 30))) {
      log(`The CPU-only Ollama didn't start. See ${path.join(dataDir, "ollama-cpu.log")}.`);
      stopCpuOllama();
      return;
    }
  }
  const second = await probeModel(CPU_BASE, probe.name, numCtx);
  if (second.ok) {
    useBase = CPU_BASE;
    log(`CPU mode works. Gen AI will use ${CPU_BASE} (answers are a little slower than on a GPU).`);
  } else {
    log(`CPU mode also failed: ${second.error.slice(0, 160)}`);
    stopCpuOllama();
  }
}

function stopCpuOllama() {
  if (cpuOllama && !cpuOllama.killed) {
    try {
      cpuOllama.kill();
    } catch {
      /* already gone */
    }
  }
  cpuOllama = null;
}

function openBrowser(url) {
  const cmd = process.platform === "win32" ? ["cmd", ["/c", "start", "", url]] : process.platform === "darwin" ? ["open", [url]] : ["xdg-open", [url]];
  try {
    spawn(cmd[0], cmd[1], { detached: true, stdio: "ignore", windowsHide: true }).unref();
  } catch {
    /* no browser */
  }
}

await prepareOllama();

const require = createRequire(import.meta.url);
const nextBin = require.resolve("next/dist/bin/next");
const host = lan ? "0.0.0.0" : "127.0.0.1";
const port = process.env.PORT || "3000";
if (!dev && !fs.existsSync(path.join(process.cwd(), ".next", "BUILD_ID"))) {
  log("No production build found. Run `npm run build` first (or use `npm run dev`).");
  stopCpuOllama();
  process.exit(1);
}

const env = {
  ...process.env,
  OLLAMA_BASE_URL: useBase,
  NODE_OPTIONS: [process.env.NODE_OPTIONS, "--disable-warning=ExperimentalWarning"].filter(Boolean).join(" "),
};
const url = `http://127.0.0.1:${port}`;
log(`Starting Gen AI at ${url}${lan ? " (also reachable from your network — there is no login)" : ""}`);
const app = spawn(process.execPath, [nextBin, dev ? "dev" : "start", "-H", host, "-p", port], { env, stdio: "inherit" });

if (open) {
  void (async () => {
    for (let i = 0; i < 120; i++) {
      try {
        await fetch(`${url}/api/settings`, { signal: AbortSignal.timeout(2000) });
        openBrowser(url);
        return;
      } catch {
        await new Promise((r) => setTimeout(r, 1000));
      }
    }
  })();
}

const shutdown = () => {
  stopCpuOllama();
  if (!app.killed) app.kill();
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
process.on("exit", stopCpuOllama);
app.on("exit", (code) => {
  stopCpuOllama();
  process.exit(code ?? 0);
});
