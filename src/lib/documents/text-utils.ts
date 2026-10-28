/** Language and text-quality helpers for English and Thai. */

const THAI = /[฀-๿]/;
const THAI_CONSONANT = /[ก-ฮ]/;
// Marks that must sit on a consonant (above/below vowels, tone marks, etc.).
const THAI_COMBINING = /[ัิ-ฺ็-๎]/;

export function thaiRatio(text: string): number {
  let thai = 0;
  let letters = 0;
  for (const ch of text) {
    if (/\s|\d|[\p{P}\p{S}]/u.test(ch)) continue;
    letters++;
    if (THAI.test(ch)) thai++;
  }
  return letters ? thai / letters : 0;
}

export function detectLanguage(text: string): "th" | "en" | "mixed" {
  const r = thaiRatio(text.slice(0, 20000));
  if (r > 0.6) return "th";
  if (r > 0.1) return "mixed";
  return "en";
}

export function wordCount(text: string): number {
  const segmenter = new Intl.Segmenter("th", { granularity: "word" });
  let n = 0;
  for (const s of segmenter.segment(text)) if (s.isWordLike) n++;
  return n;
}

export interface GarbleReport {
  garbled: boolean;
  reason: string | null;
}

/**
 * Detect text that "extracted" but is unreadable — common with Thai PDFs that use legacy font
 * encodings (characters mapped to the Private Use Area, replacement characters, or tone/vowel
 * marks that don't follow a consonant).
 */
export function checkGarbled(text: string): GarbleReport {
  const sample = text.slice(0, 50000);
  let total = 0;
  let pua = 0;
  let replacement = 0;
  let marks = 0;
  let orphanMarks = 0;
  let prev = "";
  for (const ch of sample) {
    if (/\s/.test(ch)) {
      prev = ch;
      continue;
    }
    total++;
    const code = ch.codePointAt(0)!;
    if (code >= 0xe000 && code <= 0xf8ff) pua++;
    if (code === 0xfffd) replacement++;
    if (THAI_COMBINING.test(ch)) {
      marks++;
      if (!(THAI_CONSONANT.test(prev) || THAI_COMBINING.test(prev))) orphanMarks++;
    }
    prev = ch;
  }
  if (total < 20) return { garbled: false, reason: null };
  if (pua / total > 0.02) {
    return { garbled: true, reason: "Many characters use private font codes (common with older Thai PDF fonts), so the text can't be read reliably." };
  }
  if (replacement / total > 0.01) {
    return { garbled: true, reason: "The text contains many unreadable characters (�). The file may use an unsupported text encoding." };
  }
  if (marks >= 20 && orphanMarks / marks > 0.15) {
    return { garbled: true, reason: "Thai vowel and tone marks are out of place, which usually means the PDF's Thai font encoding wasn't extracted correctly." };
  }
  return { garbled: false, reason: null };
}

/** Normalise whitespace while keeping paragraph breaks. */
export function cleanText(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/ /g, " ")
    .replace(/[\t\f\v]+/g, " ")
    .replace(/[ ]{2,}/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function decodeXmlEntities(text: string): string {
  return text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_m, d: string) => String.fromCodePoint(Number.parseInt(d, 10)))
    .replace(/&#x([0-9a-f]+);/gi, (_m, h: string) => String.fromCodePoint(Number.parseInt(h, 16)))
    .replace(/&amp;/g, "&");
}
