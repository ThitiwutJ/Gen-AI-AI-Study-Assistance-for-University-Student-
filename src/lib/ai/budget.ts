/**
 * Conservative token estimates. We don't ship each model's tokenizer, so we over-estimate:
 * Thai characters count ~1 token each (Thai is token-hungry), other text ~3.2 characters per token.
 */
export function estimateTokens(text: string): number {
  let thai = 0;
  let other = 0;
  for (const ch of text) {
    const code = ch.codePointAt(0)!;
    if (code >= 0x0e00 && code <= 0x0e7f) thai++;
    else other++;
  }
  return Math.ceil(thai * 1.0 + other / 3.2) + 4;
}

export interface BudgetItem<T> {
  item: T;
  tokens: number;
}

/** Keep items in order while they fit in `budget` tokens. */
export function fitInOrder<T>(items: T[], toText: (item: T) => string, budget: number): { kept: T[]; used: number } {
  const kept: T[] = [];
  let used = 0;
  for (const item of items) {
    const t = estimateTokens(toText(item));
    if (used + t > budget) break;
    kept.push(item);
    used += t;
  }
  return { kept, used };
}

/** Keep the most recent items (from the end) that fit, returned in original order. */
export function fitRecent<T>(items: T[], toText: (item: T) => string, budget: number): { kept: T[]; used: number } {
  const kept: T[] = [];
  let used = 0;
  for (let i = items.length - 1; i >= 0; i--) {
    const t = estimateTokens(toText(items[i]));
    if (used + t > budget) break;
    kept.unshift(items[i]);
    used += t;
  }
  return { kept, used };
}

/** Tokens available for the prompt after reserving room for the answer and a safety margin. */
export function promptBudget(numCtx: number, reservedForAnswer: number): number {
  return Math.max(512, numCtx - reservedForAnswer - 256);
}
