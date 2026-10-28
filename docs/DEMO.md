# Demo guide (about 5 minutes)

A walkthrough for showing Gen AI to a professor or classmates. It focuses on the "local knowledge" part: the answers come from **our own documents**, found and read **on this laptop**, by a **local model**.

## Before the demo

1. Start Ollama (Start menu → Ollama).
2. In the project folder: `npm run check:ai` — confirms the model answers. Note how long the first answer takes.
3. `npm run build` then `npm start`, open http://localhost:3000.
4. Warm the model up: Settings → **Test the model** (the first request loads the model into memory).
5. Optional: start from an empty app by stopping Gen AI and deleting the `data` folder.

Use the files in `samples/`. They were written for this project, and contain a few invented "course policy" facts that general knowledge can't answer — that proves answers really come from the documents.

## The walkthrough

**1. It's local (30 s).** Open **Settings**: Ollama at `127.0.0.1`, the installed models, "Test the model". Point out: no API key, nothing sent to the cloud. Optionally turn Wi-Fi off — everything still works.

**2. Add knowledge (1 min).** **Study Materials** → create a course "FIN101" → drag in `fin101-time-value-of-money.pdf` and `fin101-compound-interest-thai.docx`. Open the PDF: show the extracted text by page and the **Search index** box (passages indexed locally).

**3. Ask a question only the document can answer (1.5 min).** **AI Tutor** → materials: "All my materials" → ask:

> What is the late penalty for problem sets?

The answer uses the document (15% per day, zero after 3 days) and shows a yellow **S1** mark. Click it: the source panel shows *FIN101 Lecture 3, p. 4*. Click the title to jump to page 4. Explain: the app found the passage, gave it to the model, and checked that the citation is real.

Then ask something the material doesn't cover, e.g. *"What is the Black–Scholes formula?"* — the tutor should say the materials don't cover it and label any general-knowledge answer (small models don't always follow this; the badge above the answer shows whether it cited your materials).

**4. Thai (30 s).** Ask in Thai: *การสอบย่อยครั้งที่ 2 จัดในสัปดาห์ไหน* — answered from the Thai document (week 9). Thai search works even though Thai has no spaces between words.

**5. Study tools (1.5 min).** On the PDF → **Summarize** → "Exam notes" → the note is saved with page references. Then **Create quiz** → 5 questions → answer them → submit → review the score, explanations and source links. Switch to **Flashcards**.

**6. Robustness (30 s, optional).** Quit Ollama from the tray, click **Check again**: the app explains what's wrong and how to fix it; saved notes and quizzes still open.

## Talking points

- **RAG pipeline:** extract → chunk (with page metadata) → keyword index (SQLite FTS5) + embeddings (Ollama `/api/embed`) → hybrid search → prompt with labelled sources → citation check.
- **Honesty by design:** page numbers come from stored metadata, never from the model; invented citations are removed; quiz questions are validated; short-answer grading is marked as an AI suggestion; all statistics are from real saved data.
- **Local constraints handled:** `num_ctx` is always set (Ollama's default would silently cut off the sources), long lectures are summarized in stages, slow first loads show "Model loading", and requests can be cancelled and retried.
- **Limits:** quality depends on the model size; no OCR for scanned PDFs.
