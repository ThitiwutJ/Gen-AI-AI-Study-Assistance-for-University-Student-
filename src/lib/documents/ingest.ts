import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { config } from "@/lib/config";
import { getDb, now, uploadsDir } from "@/lib/db";
import { AppError } from "@/lib/errors";
import type { DocumentSummary, FileType } from "@/lib/types";
import { chunkUnits } from "./chunk";
import { extractDocument, extractPlainText, fileTypeFromName, type Extraction } from "./extract";
import { getDocument } from "./repo";
import { checkGarbled, detectLanguage, wordCount } from "./text-utils";
import { enqueueIndexing } from "@/lib/retrieval/indexer";

export interface IngestInput {
  title?: string;
  description?: string | null;
  courseId?: number | null;
  file?: { name: string; buffer: Buffer };
  pastedText?: string;
}

function titleFromFileName(name: string): string {
  return path.basename(name).replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").trim() || "Untitled";
}

export async function ingestDocument(input: IngestInput): Promise<DocumentSummary> {
  let extraction: Extraction;
  let fileType: FileType;
  let storedName: string | null = null;
  let fileName: string | null = null;
  let sizeBytes: number | null = null;

  if (input.file) {
    fileName = path.basename(input.file.name);
    const detected = fileTypeFromName(fileName);
    if (!detected) {
      throw new AppError(
        "unsupported_file",
        `“${fileName}” isn't a supported file type. Upload PDF, Word (.docx), PowerPoint (.pptx), or plain text (.txt, .md).`,
        415,
        "Old .doc / .ppt files: open them and save as .docx / .pptx first.",
      );
    }
    fileType = detected;
    sizeBytes = input.file.buffer.length;
    if (sizeBytes === 0) throw new AppError("empty_file", "This file is empty.", 422);
    if (sizeBytes > config.maxUploadBytes) {
      throw new AppError(
        "file_too_large",
        `This file is ${(sizeBytes / 1024 / 1024).toFixed(1)} MB. The limit is ${Math.round(config.maxUploadBytes / 1024 / 1024)} MB.`,
        413,
        "Split the document into smaller parts, or raise MAX_UPLOAD_MB in .env.local.",
      );
    }
    extraction = await extractDocument(input.file.buffer, fileType);
  } else if (input.pastedText?.trim()) {
    fileType = "paste";
    extraction = extractPlainText(input.pastedText, "paste");
  } else {
    throw new AppError("empty_input", "Choose a file or paste some notes first.", 400);
  }

  const fullText = extraction.units.map((u) => u.text).join("\n\n");
  if (fullText.replace(/\s/g, "").length < 20) {
    throw new AppError("no_text", "No readable text was found in this material, so there's nothing to study from it.", 422);
  }

  const warnings = [...extraction.warnings];
  const garble = checkGarbled(fullText);
  if (garble.garbled && garble.reason) {
    warnings.push(`${garble.reason} The text was saved so you can check it, but it isn't used for AI answers.`);
  }
  const searchable = !garble.garbled;
  const chunks = searchable ? chunkUnits(extraction.units) : [];

  if (input.file) {
    storedName = `${randomUUID()}.${fileType}`;
    fs.mkdirSync(uploadsDir(), { recursive: true });
    fs.writeFileSync(path.join(uploadsDir(), storedName), input.file.buffer);
  }

  const title = (input.title?.trim() || (fileName ? titleFromFileName(fileName) : "Pasted notes")).slice(0, 200);
  const db = getDb();
  const ts = now();
  let id = 0;
  try {
    id = db.transaction(() => {
      const res = db
        .prepare(
          `INSERT INTO documents (course_id, title, description, file_name, file_type, stored_name, size_bytes, language,
             unit_kind, unit_count, word_count, chunk_count, warning, searchable, index_status, created_at, updated_at, last_opened_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          input.courseId ?? null,
          title,
          input.description?.trim() || null,
          fileName,
          fileType,
          storedName,
          sizeBytes,
          detectLanguage(fullText),
          extraction.unitKind,
          extraction.units.length,
          wordCount(fullText),
          chunks.length,
          warnings.length ? warnings.join(" ") : null,
          searchable ? 1 : 0,
          searchable ? "pending" : "skipped",
          ts,
          ts,
          ts,
        );
      const docId = res.lastInsertRowid;
      const unitStmt = db.prepare("INSERT INTO document_units (document_id, unit_index, heading, text) VALUES (?, ?, ?, ?)");
      for (const u of extraction.units) unitStmt.run(docId, u.index, u.heading, u.text);
      const chunkStmt = db.prepare(
        "INSERT INTO chunks (document_id, position, unit_start, unit_end, heading, text, token_estimate) VALUES (?, ?, ?, ?, ?, ?, ?)",
      );
      for (const c of chunks) chunkStmt.run(docId, c.position, c.unitStart, c.unitEnd, c.heading, c.text, c.tokens);
      return docId;
    });
  } catch (error) {
    if (storedName) fs.rmSync(path.join(uploadsDir(), storedName), { force: true });
    throw error;
  }

  if (searchable) enqueueIndexing(id);
  return getDocument(id)!;
}
