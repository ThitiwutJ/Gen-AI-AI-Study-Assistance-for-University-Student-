# Testing report

This report says exactly what was tested, how, and what was **not** tested. Tests were run on 27 October 2026 in a Linux build environment (Node.js 22).

## Important: what the build environment could not do

The app was built and tested in a cloud workspace that **could not run a real AI model** (downloading Ollama models was blocked there, and the laptop's Ollama wasn't reachable from it). So:

- All AI features were tested end to end against `scripts/mock-ollama.mjs`, a **test double** that speaks the same HTTP API as Ollama (`/api/tags`, `/api/show`, `/api/ps`, `/api/chat`, `/api/embed`) and returns canned text clearly marked "mock". This proves the app's plumbing: requests, `num_ctx`, JSON schema output, citations, validation, retries, errors and saving.
- It does **not** measure answer quality. **Real-model testing must be done on the laptop** with `npm run check:ai` (see below).

## Results

| Check | Command | Result |
|---|---|---|
| Lint | `npm run lint` | ✅ Passed, 0 problems |
| Type-check | `npm run typecheck` | ✅ Passed |
| Production build | `npm run build` | ✅ Passed, no warnings |
| Unit tests | `npm test` (tests/unit.test.ts) | ✅ 24 passed |
| Search without FTS5 | `npm test` (tests/no-fts.test.ts) | ✅ 1 passed |
| Extraction tests | `npm test` (tests/extract.test.ts) | ✅ 11 passed |
| End-to-end server tests (with test double) | `npm test` (tests/integration.test.ts) | ✅ 19 passed |
| Browser walkthrough (headless Chromium, production build, test double) | manual script | ✅ Passed (details below) |
| Install on the team laptop (Windows 11, Node.js 22.15, Ollama 0.40.11) | `setup-gen-ai.bat` | ✅ `npm install` and `npm run build` passed |
| Live test against the real `gemma3:1b` on the laptop | `npm run check:ai` | See "Findings on the team laptop" below |

**Total automated tests: 55 passed, 0 failed.**

### What the automated tests cover

- **Model discovery:** chat vs. embedding vs. reasoning models from `/api/tags` + `/api/show`; context length; automatic choice of a laptop-sized model; a selected model that isn't installed is reported as "model unavailable" (not silently replaced).
- **Context window:** every `/api/chat` request carries `options.num_ctx` (asserted on the recorded requests).
- **Materials:** PDF by page, PPTX by slide with speaker notes, Thai DOCX by heading, Markdown sections, document titles, legacy Thai (Windows-874) text, rejection of scanned/image-only PDFs, corrupt PDFs, fake files, binary files, unsupported and empty files.
- **Retrieval:** a fact that only exists in the sample PDF is found with its real page number (p. 4); a Thai question finds Thai text; keyword-only fallback when no embedding model is installed; deleting a document removes its file, passages and index entries.
- **Tutor:** grounded answer keeps `[S1]` and removes an invented `[S9]`; general-knowledge mode; retry after a failure without retyping; cancel; reasoning models get `think: false` and reasoning text never reaches the answer.
- **Summaries:** note saved; a reference to a page that doesn't exist (page 999) is removed; a long document is summarized in stages.
- **Quizzes:** JSON schema sent in `format`; every question validated (answer must be one of the options, true/false normalised, invented source labels dropped); one controlled retry after invalid JSON; deterministic grading for MCQ/TF and AI grading for short answers.
- **Failure handling:** Ollama not running → clear "not running" status with start instructions, tutor job fails with `ai_not_running`, saved materials and notes still available.

### Browser walkthrough

A Playwright script drove the real UI (production build, `next start`) in headless Chromium at 1440×900 and 390×844:

- Empty dashboard with onboarding → Settings (name saved, "Test the model" round trip) → created a course → uploaded the PDF, Thai DOCX and PPTX by file picker (all "Ready", indexing reached "Indexed") → an `.exe` was rejected with a clear message → material page with extracted text and index status.
- AI Tutor: asked a question, answer showed a highlighted **S1** citation and the source panel (p. 4); clicked the citation; follow-up button worked.
- Notes: generated a detailed summary, redirected to the saved note, formula rendered with KaTeX, invalid page reference removed and reported.
- Quiz: generated 5 questions including short answer, answered, submitted, results page with score, explanations, source links and labelled AI feedback; flashcards with reveal and "mark for review".
- Library and filled dashboard (real counts and quiz score).
- Phone width: dashboard, tutor, materials and the mobile menu; no horizontal scrolling on any of the 8 main pages after fixing one overflow on the dashboard.
- Ollama stopped (pointed at a closed port): status "Not running", tutor shows the error with start instructions and **Try again**, the question stays saved, notes still open.

The only browser console error was the expected 415 response for the rejected `.exe` upload.

## Findings on the team laptop (27 October 2026)

1. **Database driver on Windows (bug, fixed).** The optional `better-sqlite3` package didn't install, and the fallback to Node's built-in SQLite failed after the production build ("Unsupported external type Url for commonjs reference"). Fixed by loading drivers through `process.getBuiltinModule`, which the bundler doesn't rewrite. Verified with a production build using only the built-in driver.
2. **Ollama crashes on the GPU (laptop driver issue).** Ollama 0.40.11's CUDA build fails on the RTX 3060 Laptop GPU with the installed driver (CUDA 12.3): `CUDA error: device kernel image is invalid`, then `llama-server process has terminated: exit status 0xc0000409`. Ollama's own log from 25 October shows the same model running on the CPU at about 35 tokens/s. Gen AI now detects the crash: `npm start` and `npm run check:ai` start a CPU-only Ollama on port 11435 and use it, and the app shows a clear "update your graphics driver" message. The automatic fallback was tested with a test double that simulates the crash.

3. **No full-text search in Node.js 22.15's SQLite (fixed).** The SQLite built into Node.js 22.15 has no FTS5 module (`no such module: fts5`). Gen AI now detects this and uses its own keyword search (candidates with `LIKE`, ranked with a BM25-style score); when FTS5 becomes available (newer Node.js, or `better-sqlite3`), the index is rebuilt automatically. Verified with a production build using only the built-in driver and FTS5 switched off.
4. **Real model results (CPU mode, `gemma3:1b`):** grounded English answer correct with `[S1]` citation in 1.7 s; Thai answer correct ("สัปดาห์ที่ 9") in 1.3 s; quiz JSON: 1 of 2 questions valid (the app drops invalid questions automatically). No embedding model installed, so search is keyword-only.

## What still needs testing on the laptop

Run these on the laptop with Ollama, in the project folder:

1. `npm install` (Windows: confirms `better-sqlite3` installs, or that the built-in SQLite fallback is used — Node.js 22.13+ required).
2. `ollama list` — confirm `gemma3:1b` (or another model) is installed.
3. `npm run check:ai` — live test of the real model: grounded English answer with citation, Thai answer, quiz JSON via the `format` schema, embeddings if installed. Expect warnings with a 1B model; see the suggestions it prints.
4. `npm run build` then `npm start`, open http://localhost:3000, and follow [DEMO.md](DEMO.md) with the files in `samples/`.
5. Note the time for the first answer (model loading) and later answers.

## Known gaps

- Real answer quality with `gemma3:1b` is unknown until step 3 above is run. Small models may ignore citation instructions, answer Thai poorly, or produce fewer valid quiz questions (invalid ones are removed and the quiz page says so).
- Windows was not used during development; the setup steps are standard Node.js/Next.js and were written for Windows, but haven't been run there by the builder.
- The optional OpenAI-compatible provider (`AI_PROVIDER=openai-compatible`) type-checks and follows the same code paths but was not tested against a real server.
- No automated accessibility audit was run; keyboard focus styles, labels and contrast were checked by hand.
