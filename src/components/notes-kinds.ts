import type { NoteKind } from "@/lib/types";

export const KINDS: { value: NoteKind; label: string; text: string }[] = [
  { value: "quick", label: "Quick overview", text: "One paragraph and the key points." },
  { value: "detailed", label: "Detailed summary", text: "Concepts, definitions, formulas, examples and takeaways." },
  { value: "exam", label: "Exam notes", text: "Definitions, formulas, distinctions, pitfalls and self-test questions." },
  { value: "beginner", label: "Beginner explanation", text: "Plain language with everyday examples." },
  { value: "topics", label: "Topic breakdown", text: "One section per topic, in lecture order." },
];

export function kindLabel(kind: NoteKind): string {
  return KINDS.find((k) => k.value === kind)?.label ?? kind;
}
