import fs from "node:fs/promises";
import { getDocument, getStoredFile } from "@/lib/documents/repo";
import { AppError } from "@/lib/errors";
import { handle, idParam, notFound } from "@/lib/http";

export const dynamic = "force-dynamic";

/** RFC 6266 / 5987: an ASCII fallback plus the exact UTF-8 name (Thai file names survive). */
function contentDisposition(type: "inline" | "attachment", fileName: string): string {
  const ascii = fileName.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return `${type}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

/**
 * The original uploaded file. PDFs (and plain text) open in the browser; Word and PowerPoint
 * files download so they open in Office. `?download=1` always downloads; `?format=base64` returns
 * JSON for the in-page viewer.
 */
export const GET = handle(async (request: Request, ctx: RouteContext<"/api/documents/[id]/file">) => {
  const id = await idParam(ctx.params);
  const doc = getDocument(id);
  if (!doc) throw notFound("Material");
  const file = getStoredFile(id);
  if (!file) {
    throw new AppError(
      "no_file",
      doc.fileType === "paste" ? "This material was pasted as text, so there is no original file. Its text is shown on the material page." : "The original file is missing from the data folder.",
      404,
      doc.fileType === "paste" ? undefined : "Upload the file again to view it. Its extracted text is still available.",
    );
  }
  const data = await fs.readFile(file.path);
  const params = new URL(request.url).searchParams;
  if (params.get("format") === "base64") {
    // For the in-page viewer: JSON is never taken over by download managers (IDM etc.).
    return { fileName: file.fileName, mime: file.mime.split(";")[0], size: data.byteLength, data: data.toString("base64") };
  }
  const download = params.get("download") === "1";
  const text = file.fileType === "txt" || file.fileType === "md";
  const inline = !download && (file.fileType === "pdf" || text);
  let contentType = file.mime;
  if (text) {
    // Old Thai text files are often Windows-874 rather than UTF-8; label them so they display correctly.
    let utf8 = true;
    try {
      new TextDecoder("utf-8", { fatal: true }).decode(data);
    } catch {
      utf8 = false;
    }
    contentType = `${inline ? "text/plain" : file.mime.split(";")[0]}; charset=${utf8 ? "utf-8" : "windows-874"}`;
  }
  return new Response(new Uint8Array(data), {
    headers: {
      "content-type": contentType,
      "content-length": String(data.byteLength),
      "content-disposition": contentDisposition(inline ? "inline" : "attachment", file.fileName),
      "x-content-type-options": "nosniff",
      "cache-control": "private, max-age=0, must-revalidate",
      // Same-origin framing only (the material page shows PDFs in a frame).
      "x-frame-options": "SAMEORIGIN",
    },
  });
});
