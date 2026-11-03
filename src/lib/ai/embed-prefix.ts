/**
 * Some embedding models were trained with task prefixes and give noticeably better search
 * results when passages and questions are marked. nomic-embed-text (used in the course lab)
 * expects "search_document: " for stored text and "search_query: " for questions.
 */
export function embedPrefix(model: string, task: "document" | "query"): string {
  const name = model.toLowerCase();
  if (name.includes("nomic-embed")) return task === "document" ? "search_document: " : "search_query: ";
  if ((name.includes("mxbai-embed") || name.includes("snowflake-arctic-embed")) && task === "query") {
    return "Represent this sentence for searching relevant passages: ";
  }
  return "";
}
