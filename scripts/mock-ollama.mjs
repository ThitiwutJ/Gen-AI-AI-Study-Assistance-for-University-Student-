#!/usr/bin/env node
/**
 * TEST DOUBLE — NOT A REAL AI MODEL.
 *
 * A tiny HTTP server that imitates the parts of the Ollama API that Gen AI uses
 * (/api/version, /api/tags, /api/show, /api/ps, /api/chat, /api/embed) so the app's
 * plumbing can be tested on machines without Ollama. Its "answers" are canned text built
 * from the prompt; they say so explicitly. Real-model testing uses `npm run check:ai`.
 *
 * Run standalone:  node scripts/mock-ollama.mjs --port 11435
 * Options (env):   MOCK_EMBED=0 (no embedding model), MOCK_THINK=1 (add a thinking model),
 *                  MOCK_BAD_JSON=1 (first structured reply is invalid JSON), MOCK_DELAY_MS=15
 */
import http from "node:http";

function embedText(text, dim = 256) {
  const v = new Float32Array(dim);
  const s = ` ${text.toLowerCase().replace(/\s+/g, " ")} `;
  for (let i = 0; i < s.length - 2; i++) {
    const tri = s.slice(i, i + 3);
    let h = 2166136261;
    for (const ch of tri) h = Math.imul(h ^ ch.codePointAt(0), 16777619);
    v[Math.abs(h) % dim] += 1;
  }
  let norm = 0;
  for (const x of v) norm += x * x;
  norm = Math.sqrt(norm) || 1;
  return Array.from(v, (x) => x / norm);
}

function parseSources(text) {
  const out = [];
  const re = /\[(S\d+)\] ([^\n]*)\n([\s\S]*?)(?=\n\n---\n\n\[S\d+\]|\n\nQUESTION:|\n\nWrite exactly|\n\nTOPIC:|$)/g;
  let m;
  while ((m = re.exec(text))) out.push({ label: m[1], title: m[2], text: m[3].trim() });
  return out;
}

function firstSentence(text) {
  const s = text.replace(/\s+/g, " ").trim().split(/(?<=[.!?。])\s/)[0] ?? text;
  return s.length > 140 ? `${s.slice(0, 137)}…` : s;
}

export function startMockOllama(options = {}) {
  const opts = {
    embed: options.embed ?? process.env.MOCK_EMBED !== "0",
    think: options.think ?? process.env.MOCK_THINK === "1",
    badJson: options.badJson ?? process.env.MOCK_BAD_JSON === "1",
    delayMs: options.delayMs ?? Number(process.env.MOCK_DELAY_MS ?? 5),
    port: options.port ?? 0,
  };
  const requests = [];
  const loaded = new Set();
  let structuredCalls = 0;

  const models = () => [
    { name: "mock-chat:1b", size: 815_000_000, digest: "a1", details: { family: "mock", parameter_size: "1B" }, caps: ["completion"] },
    ...(opts.embed ? [{ name: "mock-embed:latest", size: 300_000_000, digest: "b2", details: { family: "mock", parameter_size: "137M" }, caps: ["embedding"] }] : []),
    ...(opts.think ? [{ name: "mock-think:4b", size: 2_500_000_000, digest: "c3", details: { family: "mock", parameter_size: "4B" }, caps: ["completion", "thinking"] }] : []),
  ];

  const server = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const raw = Buffer.concat(chunks).toString("utf8");
    let body = {};
    try {
      body = raw ? JSON.parse(raw) : {};
    } catch {
      /* ignore */
    }
    requests.push({ method: req.method, url: req.url, body });
    const json = (status, data) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(data));
    };
    const model = models().find((m) => m.name === body.model);

    if (req.url === "/api/version") return json(200, { version: "0.0.0-mock" });
    if (req.url === "/api/tags") return json(200, { models: models().map(({ caps: _c, ...m }) => ({ ...m, model: m.name })) });
    if (req.url === "/api/ps") return json(200, { models: [...loaded].map((name) => ({ name, model: name })) });
    if (req.url === "/__requests") return json(200, requests);
    if (req.url === "/api/show") {
      if (!model) return json(404, { error: `model '${body.model}' not found` });
      return json(200, { capabilities: model.caps, details: model.details, model_info: { "general.architecture": "mock", "mock.context_length": 32768 } });
    }
    if (req.url === "/api/embed") {
      if (!model) return json(404, { error: `model '${body.model}' not found` });
      if (!model.caps.includes("embedding")) return json(400, { error: `"${body.model}" does not support embeddings` });
      const inputs = Array.isArray(body.input) ? body.input : [body.input];
      return json(200, { model: body.model, embeddings: inputs.map((t) => embedText(String(t))) });
    }
    if (req.url === "/api/chat") {
      if (!model) return json(404, { error: `model '${body.model}' not found` });
      if (body.think !== undefined && !model.caps.includes("thinking")) return json(400, { error: `"${body.model}" does not support thinking` });
      loaded.add(model.name);
      const messages = body.messages ?? [];
      const last = String(messages[messages.length - 1]?.content ?? "");
      const system = String(messages.find((m) => m.role === "system")?.content ?? "");
      let content;

      if (body.format && typeof body.format === "object") {
        structuredCalls++;
        const props = body.format.properties ?? {};
        if (opts.badJson && structuredCalls === 1) {
          content = '{"questions": [ this is not valid json';
        } else if (props.questions) {
          const types = (last.match(/in this order: ([a-z, ]+)\./)?.[1] ?? "mcq").split(",").map((t) => t.trim());
          const sources = parseSources(last);
          const topic = last.match(/TOPIC: (.*)/)?.[1];
          const questions = types.map((type, i) => {
            const src = sources[i % Math.max(1, sources.length)];
            const fact = src ? firstSentence(src.text) : `${topic ?? "the topic"} is an important idea`;
            const label = src?.label ?? "";
            if (type === "tf") return { type, question: `(mock) True or false: ${fact}`, options: ["True", "False"], answer: "True", explanation: `(mock) This statement appears in ${label || "the topic"}.`, source: label };
            if (type === "short") return { type, question: `(mock) Explain in your own words: ${fact}`, options: [], answer: fact, explanation: "(mock) The model answer restates the source.", source: label };
            return {
              type: "mcq",
              question: `(mock) Which statement matches the material? #${i + 1}`,
              options: [fact, `Not: ${fact}`.slice(0, 120), "None of the other options", "All of the other options"],
              answer: fact,
              explanation: `(mock) The first option is quoted from ${label || "the topic"}; the others contradict it.`,
              source: label,
            };
          });
          content = JSON.stringify({ questions });
        } else if (props.verdict) {
          content = JSON.stringify({ verdict: "partial", score: 0.5, feedback: "(mock grading) Partly matches the model answer." });
        } else {
          content = "{}";
        }
      } else if (/combine partial study notes|study notes|lecture summary|overview/i.test(system)) {
        content = `## (Mock summary — test double, not a real model)\n\n- First point from the material (page 1)\n- A reference the document does not have (page 999)\n- Formula: $FV = PV(1+r)^n$`;
      } else {
        const sources = parseSources(last);
        const question = last.split("QUESTION:\n").pop()?.slice(0, 120) ?? last.slice(0, 120);
        content = sources.length
          ? `**Mock answer (test double, not a real model)** to: ${question}\n\nThe material says: ${firstSentence(sources[0].text)} [S1]. An invented citation that must be removed [S9].`
          : `**Mock answer (test double, not a real model)** to: ${question}\n\nNo sources were provided.`;
      }

      res.writeHead(200, { "content-type": "application/x-ndjson" });
      const send = (obj) => res.write(`${JSON.stringify(obj)}\n`);
      const wait = () => new Promise((r) => setTimeout(r, opts.delayMs));
      if (model.caps.includes("thinking") && body.think !== false && body.think !== "low") {
        send({ model: model.name, message: { role: "assistant", content: "", thinking: "(mock reasoning that must never be shown)" }, done: false });
      }
      if (process.env.MOCK_THINK_IN_CONTENT === "1") content = `<think>hidden reasoning</think>${content}`;
      const pieces = content.match(/[\s\S]{1,12}/g) ?? [content];
      for (const piece of pieces) {
        if (res.destroyed) return;
        send({ model: model.name, message: { role: "assistant", content: piece }, done: false });
        await wait();
      }
      const promptText = messages.map((m) => m.content).join(" ");
      send({ model: model.name, message: { role: "assistant", content: "" }, done: true, done_reason: "stop", prompt_eval_count: Math.ceil(promptText.length / 4), eval_count: pieces.length });
      return res.end();
    }
    json(404, { error: "not found" });
  });

  return new Promise((resolve) => {
    server.listen(opts.port, "127.0.0.1", () => {
      const { port } = server.address();
      resolve({
        url: `http://127.0.0.1:${port}`,
        requests,
        close: () => new Promise((r) => server.close(() => r())),
      });
    });
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const portArg = process.argv.indexOf("--port");
  const port = portArg !== -1 ? Number(process.argv[portArg + 1]) : 11435;
  startMockOllama({ port }).then(({ url }) => console.log(`Mock Ollama (TEST DOUBLE, not a real model) listening on ${url}`));
}
