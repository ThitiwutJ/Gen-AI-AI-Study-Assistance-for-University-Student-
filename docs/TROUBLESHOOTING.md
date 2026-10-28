# Troubleshooting

Start with **Settings** in the app: it shows the connection state, installed models and the exact problem. Then run `npm run check:ai` in the project folder for a live test of your models.

## "Not running" — Gen AI can't reach Ollama

- **Windows:** open **Ollama** from the Start menu. It runs in the background with an icon in the system tray. Or open a terminal and run `ollama serve` (keep the window open).
- **macOS:** open the Ollama app. **Linux:** `ollama serve` or `systemctl start ollama`.
- Check it responds: open http://127.0.0.1:11434 in a browser — it should say "Ollama is running".
- If Ollama runs on a different port or address, set `OLLAMA_BASE_URL` in `.env.local` and restart Gen AI.
- Then click **Check again** in Settings. Your saved materials, notes and quizzes are unaffected while Ollama is off.

## "Ollama crashed while loading the model" / `CUDA error` / `exit status 0xc0000409`

Ollama's GPU (CUDA) build needs a recent graphics driver. With an older driver, loading any model crashes. Ollama's log (`%LOCALAPPDATA%\Ollama\server.log`) then shows `CUDA error: device kernel image is invalid`.

- **Quick fix (already built in):** start Gen AI with `npm start`. It detects the crash and runs a CPU-only Ollama for Gen AI on port 11435. `npm run check:ai` does the same and tells you whether CPU mode works.
- **Proper fix:** update the graphics driver — for NVIDIA, open the **NVIDIA app** → Drivers → download the latest Game Ready or Studio driver (or get it from nvidia.com/drivers), restart, then run `npm run check:ai` again. With a working GPU, answers are faster.

## "Model unavailable" — the selected model isn't installed

- Run `ollama list` to see what's installed.
- In Settings, choose an installed model, or set **Chat model** to **Automatic**.
- Or install the missing model: `ollama pull <model-name>` (check its size on ollama.com first).
- If `OLLAMA_MODEL` is set in `.env.local` to a model you don't have, remove or fix it.

## "No chat model" — only embedding models are installed

Install a chat model, for example `ollama pull gemma3:4b` (about 3 GB) or the smaller `ollama pull gemma3:1b`.

## Search says "keyword search" — no embedding model

Gen AI works without one, using keyword search. For better results (especially for questions worded differently from the lecture), install a multilingual embedding model:

```
ollama pull qwen3-embedding:0.6b
```

Click **Check again** in Settings; existing materials are indexed automatically. If you later switch embedding models, use **Re-index documents** in Settings.

## Answers are slow

Local models run on your laptop's CPU/GPU, so speed depends on the hardware.

- The **first** request after a pause loads the model into memory (the status shows "Model loading"). Later requests are faster; the model stays loaded for 10 minutes (`OLLAMA_KEEP_ALIVE`).
- Use a smaller model, or lower the **context window** in Settings (e.g. 4,096). Smaller context = less memory and faster, but fewer passages per answer.
- Select specific materials instead of "All my materials", and ask focused questions.
- Close other heavy apps. Long summaries of big lectures run several model calls; the progress bar shows each part.
- If requests time out, raise `AI_REQUEST_TIMEOUT_MS` in `.env.local` (default 10 minutes).

## Answers are poor, in the wrong language, or quizzes fail

- Very small models (≈1B parameters) often ignore instructions, answer Thai badly, and produce invalid quiz JSON. Gen AI validates every quiz question and removes broken ones; if none are valid it shows an error instead of a broken quiz.
- `npm run check:ai` shows how your model does on English, Thai and quiz JSON.
- A ~4B model (e.g. `gemma3:4b`) is a big improvement if your laptop has 8 GB+ RAM.
- Choose the answer language explicitly in the tutor (English / ภาษาไทย) instead of "same as question".

## Answers seem to ignore my material ("Not found in your materials")

- Check the material picker above the chat — the tutor only searches the materials you selected.
- Open the material and look at **Extracted text**. If it's empty or garbled, the AI can't use it.
- Use words that appear in the lecture, or install an embedding model for meaning-based search.

## Uploads

- **"No readable text … probably scanned"** — the PDF pages are images. Gen AI has no OCR. Export a text-based PDF, or paste the notes.
- **Thai PDF warning about font encoding** — some Thai PDFs use old fonts whose text can't be extracted correctly. The text is saved so you can look at it but isn't used for answers. Try exporting the PDF again from Word/PowerPoint, upload the .docx/.pptx instead, or paste the text.
- **Old .doc / .ppt** — open and save as .docx / .pptx.
- **File too large** — the default limit is 25 MB (`MAX_UPLOAD_MB`). Split the document or raise the limit.

## Context window warnings in the terminal

If the terminal shows `prompt used N of M context tokens`, the prompt was close to the context window. Gen AI budgets prompts to fit `num_ctx`, but token counts are estimates. Lower the number of selected materials or raise the context window in Settings (if your model and RAM allow).

## Installation problems

- **`better-sqlite3` didn't install** (common on Windows) — that package is optional. With Node.js 22.13 or newer, Gen AI automatically uses Node's built-in SQLite instead. Check your version with `node -v`.
- **"No SQLite driver is available"** — update Node.js to 22.13+ (22 LTS or 24 LTS).
- **Port 3000 in use** — `npx next start -H 127.0.0.1 -p 3001`.

## Reset everything

Stop Gen AI and delete the `data` folder in the project. Ollama models are not affected.
