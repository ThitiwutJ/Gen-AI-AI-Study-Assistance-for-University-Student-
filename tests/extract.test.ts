import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { decodeText, extractDocument, fileTypeFromName } from "@/lib/documents/extract";

const read = (p: string) => fs.readFileSync(p);

describe("extraction of the sample materials", () => {
  it("reads a PDF page by page", async () => {
    const e = await extractDocument(read("samples/fin101-time-value-of-money.pdf"), "pdf");
    expect(e.unitKind).toBe("page");
    expect(e.units.map((u) => u.index)).toEqual([1, 2, 3, 4]);
    expect(e.units[3].text).toContain("15%");
    expect(e.title).toBe("FIN101 Lecture 3: The Time Value of Money");
  });

  it("reads a PowerPoint slide by slide, including speaker notes", async () => {
    const e = await extractDocument(read("samples/econ102-supply-and-demand.pptx"), "pptx");
    expect(e.unitKind).toBe("slide");
    expect(e.units).toHaveLength(6);
    expect(e.units[1].heading).toBe("The law of demand");
    expect(e.units[1].text).toContain("Speaker notes:");
    expect(e.title).toBe("ECON102: Supply and Demand");
  });

  it("reads a Thai Word document by heading", async () => {
    const e = await extractDocument(read("samples/fin101-compound-interest-thai.docx"), "docx");
    expect(e.unitKind).toBe("section");
    expect(e.units.some((u) => u.heading?.includes("กฎ 72"))).toBe(true);
    expect(e.units.map((u) => u.text).join(" ")).toContain("สัปดาห์ที่ 9");
  });

  it("reads Markdown sections", async () => {
    const e = await extractDocument(read("samples/study-skills-notes.md"), "md");
    expect(e.units.map((u) => u.heading)).toContain("Spaced repetition");
  });
});

describe("problem files", () => {
  it("explains that image-only (scanned) PDFs can't be read", async () => {
    await expect(extractDocument(read("tests/fixtures/image-only.pdf"), "pdf")).rejects.toThrow(/scanned|images/i);
  });
  it("rejects a corrupt PDF with a clear message", async () => {
    await expect(extractDocument(read("tests/fixtures/corrupt.pdf"), "pdf")).rejects.toThrow(/couldn't be read|valid PDF/i);
  });
  it("rejects a file that only pretends to be a PDF", async () => {
    await expect(extractDocument(Buffer.from("hello"), "pdf")).rejects.toThrow(/valid PDF/);
  });
  it("rejects a fake Word file", async () => {
    await expect(extractDocument(Buffer.from("not a zip"), "docx")).rejects.toThrow(/Word/);
  });
  it("does not accept unsupported types", () => {
    expect(fileTypeFromName("notes.exe")).toBeNull();
    expect(fileTypeFromName("slides.ppt")).toBeNull();
    expect(fileTypeFromName("Lecture.PDF")).toBe("pdf");
  });
  it("decodes legacy Thai (Windows-874) text files", () => {
    expect(decodeText(read("tests/fixtures/legacy-thai.txt"))).toContain("ดอกเบี้ยทบต้น");
  });
  it("rejects binary data posing as text", () => {
    expect(() => decodeText(Buffer.from([0x4d, 0x5a, 0x00, 0x01]))).toThrow(/binary/);
  });
});
