/**
 * Reasoning ("thinking") models can put their reasoning inside the answer as <think>…</think>
 * (older Ollama versions, some templates). We never show or store that text as part of an answer.
 */
export function stripThinking(content: string): { answer: string; thinking: string | null } {
  const thoughts: string[] = [];
  let answer = content.replace(/<think>([\s\S]*?)<\/think>/gi, (_m, inner: string) => {
    thoughts.push(inner.trim());
    return "";
  });
  // An unclosed <think> (still streaming, or truncated output): hide everything after it.
  const open = answer.search(/<think>/i);
  if (open !== -1) {
    thoughts.push(answer.slice(open + 7).trim());
    answer = answer.slice(0, open);
  }
  // A stray closing tag with reasoning before it (some templates omit the opening tag).
  const close = answer.search(/<\/think>/i);
  if (close !== -1) {
    thoughts.push(answer.slice(0, close).trim());
    answer = answer.slice(close + 8);
  }
  return { answer: answer.trim(), thinking: thoughts.length ? thoughts.join("\n\n") : null };
}
