# Gen AI — Your Personal AI Study Assistant

An AI study assistant for university students that learns from **your own course materials** and runs on a **local AI model (Ollama)**. Upload a lecture, ask questions and get answers that cite the exact page or slide, generate study notes, and practise with quizzes. No paid API key is needed, and your files never leave your computer.

## Assignment: "AI with local knowledge"

**Topic:** using a local large language model (Ollama) together with our own course materials, stored and searched on our own laptop, to help university students study. The "local knowledge" is the student's uploaded documents: they are extracted, split into passages, indexed and searched locally, and the most relevant passages are given to the local model so its answers are grounded in the material and cite their sources (retrieval-augmented generation, RAG).

### Team

| Name | Nickname | Student ID |
| ---- | -------- | ---------- |
| _Name 1_ | _Nickname_ | _ID_ |
| _Name 2_ | _Nickname_ | _ID_ |
| _Name 3 (if any)_ | _Nickname_ | _ID_ |

> Student IDs are also submitted to our professor directly; decide as a team whether to list them in this public README.

## Features

| | Feature | What it does |
|---|---|---|
| ✅ | **Local AI connection** | Detects your installed Ollama models, shows a live status (connected, model loading, generating, not running, model missing), and lets you pick models in Settings. |
| ✅ | **Study materials** | Upload PDF, Word (.docx), PowerPoint (.pptx), .txt/.md, or paste notes. Drag and drop, courses, rename, delete, view the extracted text page by page. |
| ✅ | **Local knowledge retrieval** | Passages are indexed for keyword search (SQLite FTS5, works for Thai) and semantic search (local embeddings). Hybrid ranking picks the best passages for each question. |
| ✅ | **AI Tutor** | Grounded answers with highlighted citations like **S1** that link to the exact page; levels (beginner / standard / exam-ready); English or Thai; follow-up buttons; saved conversations; retry after errors. |
| ✅ | **Knows its document collection** | Ask *"What are the papers in my document collection?"* and the tutor lists every file with its index status (e.g. *Indexed · 111 chunks*) and what its opening says, cited as **D1**, **D2**…. Ordinary answers name the document each passage comes from. |
| ✅ | **Open the original file** | Click a material to see the uploaded PDF in the browser (or download Word/PowerPoint files); jump from any page of the extracted text to the same page in the PDF. |
| ✅ | **Search depth and time limits** | Settings → *Passages per answer* (4–16) and *Time limit per answer* (5–60 min). Multi-part questions and "each paper" questions run several searches so every part and every document is covered. |
| ✅ | **Summaries & notes** | Quick overview, detailed summary, exam notes, beginner explanation, topic breakdown. Long lectures are summarized in parts and combined. Notes are saved and can be renamed, copied, downloaded or deleted. |
| ✅ | **Practice quizzes** | Multiple choice, true/false and short answer from your materials. Every generated question is validated; short answers are graded by the local model and labelled as AI suggestions. Scores come from your real answers. |
| ✅ | **Flashcards** | Flip through any quiz as flashcards and mark cards for review. |
| ✅ | **Dashboard & library** | Recent materials, notes, real quiz results, courses, and a searchable library of everything you've saved. |
| ✅ | **Streaming-style answers** | Answers appear as the model writes them, with a Stop button. |
| ◻️ | Polished mobile layout | Works on phones (no broken layouts), but is designed mainly for laptop screens. |

## How it works

```mermaid
flowchart LR
  B[Browser<br/>Gen AI pages] -->|HTTP| N[Next.js server<br/>on this laptop]
  N --> S[(SQLite database<br/>data/genai.db)]
  N --> U[[Uploaded files<br/>data/uploads/]]
  N -->|127.0.0.1:11434| O[Ollama<br/>local models]
```

All AI calls go **browser → Gen AI server → Ollama** on the same computer. The browser never talks to Ollama directly, and nothing is sent to a cloud AI service.

### How "local knowledge" works

1. **Extraction** — text is read locally: per page (PDF), per slide including speaker notes (PPTX), or per heading section (Word, Markdown). Scanned/image-only pages and garbled Thai PDF fonts are detected and reported instead of being indexed as junk.
2. **Chunking** — text is split into ~450-token passages with overlap, at sentence and word boundaries found with `Intl.Segmenter` (Thai has no spaces between words). Every passage keeps the page/slide/section it came from.
3. **Indexing** — passages go into a SQLite FTS5 keyword index (trigram tokenizer, so Thai is searchable) and, if an embedding model is installed, are embedded with Ollama's `/api/embed` and stored as vectors in SQLite.
4. **Retrieval** — each question is searched with keywords and vectors; results are merged with reciprocal-rank fusion. Without an embedding model the app still works with keyword search.
5. **More searches for harder questions** — a question with several parts is searched part by part, and a question about *each* or *all* documents also searches every document separately; the results are merged without duplicates, up to the *Passages per answer* setting.
6. **Grounded generation** — the best passages are labelled `[S1]`, `[S2]`… (with their document title, page and file name) and sent to the chat model with the question and recent conversation, sized to fit the context window (`num_ctx` is always set explicitly).
7. **The document collection** — the model also gets a list of the documents it can use, labelled `[D1]`, `[D2]`…, with each file's name, page count, size and index status. For questions about the collection itself it gets each document's opening excerpt too, so it can say what each paper is about.
8. **Citations** — the model cites labels; the app keeps only labels it actually supplied and shows each source with its real page number from stored metadata. Page numbers are never taken from the model.

## Lab 4: a personal AI assistant with knowledge about our topic

| Lab task | Where it is in Gen AI |
|---|---|
| Run `qwen3:1.7b` and `nomic-embed-text` locally | Both are picked automatically when installed (Settings shows which models are in use). |
| **Task 1:** the program must name its sources | Ask *"What are the papers in my document collection?"*: the tutor lists each file with *Indexed · N chunks* and an opening excerpt, and a **Documents in your collection** panel shows the same facts from the database. Every other answer cites passages (**S1**) with document, page and file name. Code: `src/lib/retrieval/collection.ts`, `src/lib/features/tutor.ts`. |
| **Task 2:** click an uploaded file to show it | **Study Materials** → click a file (or the open icon) → the original PDF opens in the page; *View in PDF* on any page of the extracted text. Code: `src/app/api/documents/[id]/file/route.ts`, `src/app/materials/[id]/page.tsx`. |
| **Task 3:** upload the software to GitHub | This repository. |
| **Task 4:** 4–5 PDFs important for our topic | See [Our topic documents](#our-topic-documents). |
| Longer timeouts, more searches | Settings → *Time limit per answer* and *Passages per answer*; multi-part and "each paper" questions run several searches (see step 5 above). |

### Our topic documents

Our topic is AI as a study assistant, so our collection is research on how AI helps (and can harm) learning, how "local knowledge" (RAG) works, and the policy guidance for using generative AI in education. The PDFs are not stored in this repository (copyright); they are free to download from the links below and are uploaded into Gen AI under the course *"Our topic: AI study assistants"*.

| # | Document | Why it matters for our topic |
|---|---|---|
| 1 | Lewis, P. et al. (2020). *Retrieval-Augmented Generation for Knowledge-Intensive NLP Tasks.* NeurIPS. [arXiv:2005.11401](https://arxiv.org/abs/2005.11401) | The original RAG paper: the method Gen AI uses to give a local model "local knowledge". |
| 2 | Kasneci, E. et al. (2023). *ChatGPT for good? On opportunities and challenges of large language models for education.* Learning and Individual Differences, 103. [Open-access copy](https://opus.bibliothek.uni-augsburg.de/opus4/files/109030/109030.pdf) | Overview of what large language models can and can't do for students and teachers. |
| 3 | UNESCO (2023). *Guidance for generative AI in education and research.* [PDF](https://www.teachertaskforce.org/sites/default/files/2023-09/2023_UNESCO_Guidance-for-generative-AI-in-education-and-research_EN.pdf) | Policy guidance, including data privacy, which is why Gen AI keeps everything on the laptop. |
| 4 | Bastani, H. et al. (2025). *Generative AI without guardrails can harm learning: Evidence from high school mathematics.* PNAS, 122(26). [doi:10.1073/pnas.2422633122](https://doi.org/10.1073/pnas.2422633122) | Field experiment: unrestricted ChatGPT use hurt exam results, while a tutor version with safeguards largely avoided the harm — the case for grounded answers, citations and practice quizzes. |
| 5 | Kestin, G. et al. (2025). *AI tutoring outperforms in-class active learning: an RCT introducing a novel research-based design in an authentic educational setting.* Scientific Reports, 15. [doi:10.1038/s41598-025-97652-6](https://doi.org/10.1038/s41598-025-97652-6) | Randomized trial at Harvard: a well-designed AI tutor helped students learn more in less time. |

To add them on another computer: put the PDFs in a folder, start Gen AI, and run `npm run import -- "<folder>" --course "Our topic: AI study assistants"`.

## Requirements

- **Node.js 22.13 or newer** (22 LTS or 24 LTS) — https://nodejs.org
- **Ollama** — https://ollama.com, with at least one chat model installed
- Windows, macOS or Linux. About 300 MB of disk for the app; models need their own space.

Recommended models (check sizes on ollama.com before downloading):

| Purpose | Model | Notes |
|---|---|---|
| Chat (course lab) | `qwen3:1.7b` | About 1.4 GB. The model used in the course lab; Gen AI picks it automatically and turns its "thinking" off so answers come quickly. |
| Embeddings (course lab) | `nomic-embed-text` | About 270 MB. Turns on semantic search (English). Gen AI adds the `search_document:` / `search_query:` prefixes this model expects. |
| Chat (smaller) | `gemma3:1b` | Fast, but weak at long explanations, Thai, and quiz JSON. |
| Chat (better) | `gemma3:4b` | Good step up if your laptop has 8 GB+ RAM. |
| Embeddings (Thai) | `qwen3-embedding:0.6b` | Multilingual (English + Thai) alternative to `nomic-embed-text`. |

Install the lab models with `ollama pull qwen3:1.7b` and `ollama pull nomic-embed-text`.

Gen AI never downloads models by itself.

## Setup and run (Windows)

1. Install Node.js and Ollama, and make sure Ollama is running (it starts from the Start menu and sits in the system tray).
2. Open **PowerShell** or **Command Prompt** and run:
   ```powershell
   git clone https://github.com/ThitiwutJ/Gen-AI-AI-Study-Assistance-for-University-Student-.git gen-ai
   cd gen-ai
   npm install
   ollama list
   npm run check:ai
   ```
   `ollama list` shows your models. `npm run check:ai` sends real test prompts to your local model and reports how well it handles grounded answers, Thai and quiz JSON.
3. Start the app:
   ```powershell
   npm run build
   npm start
   ```
   Open http://localhost:3000 (or http://127.0.0.1:3000). (For development with hot reload use `npm run dev` instead.)

   `npm start` first checks that Ollama can load your model. If loading crashes because the graphics driver is too old for your Ollama version (`CUDA error`, `llama-server process has terminated`), it automatically starts a **CPU-only** Ollama for Gen AI on port 11435 and uses that instead. Nothing on your system is changed, and it stops when Gen AI stops. Updating the graphics driver lets Ollama use the GPU again.
4. In the app: **Settings** shows the connection and models → **Study Materials** to upload a lecture (try the files in `samples/`) → **AI Tutor** to ask questions.

On macOS/Linux the commands are the same in Terminal; start Ollama with the Ollama app or `ollama serve`.

### Configuration

Optional. Copy `.env.example` to `.env.local` and change what you need (model names, context window, data folder, upload limit). No secrets are required. Settings chosen in the app (models, context window) are saved in the database and take priority over `.env.local`.

### Showing it on another device on the same Wi-Fi (for a demo)

`npm start` and `npm run dev` only accept connections from the laptop itself. To let a phone or another laptop on the same network open it, run `npm run build` and then `npm run start:lan`, and visit `http://<laptop-ip>:3000`. **There are no logins**, so anyone on that network can then see your materials; only do this on a trusted network, and stop it afterwards. Ollama itself stays on 127.0.0.1 and is never exposed.

## Where your data is stored

Everything is stored **locally on this computer** in the `data` folder of the project:

- `data/genai.db` — SQLite database (courses, extracted text, passages, vectors, notes, conversations, quizzes, attempts, settings)
- `data/uploads/` — the original files you uploaded

There are no accounts, no cloud storage and no sync between devices. To reset Gen AI, stop it and delete the `data` folder. The `data` folder is excluded from Git.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Development server with hot reload |
| `npm run build` / `npm start` | Production build / start (this computer only; falls back to CPU-only Ollama if the GPU crashes) |
| `npm run start:next` | Start without the Ollama check or CPU fallback |
| `npm run start:lan` | Start so other devices on the same network can open it (no login — trusted networks only) |
| `npm run check:ai` | Live test of your real Ollama models |
| `npm run import -- <folder> --course "Name"` | Upload every PDF/DOCX/PPTX/TXT/MD file in a folder to the running app (skips files already uploaded) |
| `npm test` | Unit + integration tests (uses a test double instead of Ollama) |
| `npm run typecheck` / `npm run lint` | Type-check / lint |
| `npm run samples` | Rebuild the sample documents (needs Python + reportlab, python-docx, python-pptx) |

## Project structure

```
src/app/            pages (dashboard, tutor, materials, notes, quizzes, library, settings) and API routes
src/lib/ai/         AI service layer: Ollama provider, model discovery, num_ctx, JSON schema output, reasoning-model handling
src/lib/documents/  extraction (PDF/DOCX/PPTX/text), chunking, Thai text checks, ingestion
src/lib/retrieval/  keyword + vector search, embedding indexer, citation checking
src/lib/features/   tutor, summaries, quizzes and grading, prompts
src/lib/data/       SQLite data access
samples/            sample study materials written for this project (safe to share)
scripts/            check-ollama (live test), mock-ollama (test double), make-samples
tests/              unit, extraction and end-to-end server tests
docs/               testing report, troubleshooting, demo guide, assignment answers
```

## Documentation

- [Testing report](docs/TESTING.md) — what was tested, how, and what still needs testing on your laptop
- [Troubleshooting](docs/TROUBLESHOOTING.md) — Ollama not running, missing models, slow answers, Thai PDFs
- [Demo guide](docs/DEMO.md) — a 5-minute walkthrough for a professor
- [Assignment answers](docs/ASSIGNMENT.md) — text to submit

## Limitations

- Answer quality depends on the local model. Very small models (≈1B) make mistakes, may answer Thai poorly, and can produce weak quiz questions; every quiz question is validated and bad ones are removed, but correctness of content can't be guaranteed. Always check the cited source.
- Scanned PDFs (pages that are images) can't be read — there is no OCR.
- Old `.doc` / `.ppt` files aren't supported; save them as `.docx` / `.pptx`.
- Short-answer grading is an AI suggestion, not an exact grade.
- Single user, no login. Don't expose it on untrusted networks.
- On Windows, the optional `better-sqlite3` package often can't install; Gen AI then uses the SQLite built into Node.js 22.13+ (verified on the team laptop).
- If the GPU driver is too old for the installed Ollama, models run on the CPU instead (slower, but a 1B model still writes about 35 tokens per second on a Ryzen 7 laptop).

## Privacy

Documents, extracted text, embeddings, answers and quiz results stay on your computer. The only network traffic is between your browser and the local Gen AI server, and between that server and Ollama on `127.0.0.1`. Fonts and libraries are bundled locally; no external services are contacted at runtime.
