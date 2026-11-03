import { getDb } from "@/lib/db";
import { config } from "@/lib/config";
import type { LanguagePref, SettingsView } from "@/lib/types";

const DEFAULTS: SettingsView = {
  displayName: "",
  chatModel: "",
  embedModel: "",
  numCtx: config.numCtx,
  defaultLanguage: "auto",
  passages: 8,
  timeoutMinutes: Math.round(config.requestTimeoutMs / 60_000),
};

function intSetting(raw: string | undefined, fallback: number, min: number, max: number): number {
  const n = Number.parseInt(raw ?? "", 10);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
}

export function getSettings(): SettingsView {
  const rows = getDb().prepare("SELECT key, value FROM settings").all<{ key: string; value: string }>();
  const map = new Map(rows.map((r) => [r.key, r.value]));
  const numCtx = Number.parseInt(map.get("numCtx") ?? "", 10);
  const lang = map.get("defaultLanguage");
  return {
    displayName: map.get("displayName") ?? DEFAULTS.displayName,
    chatModel: map.get("chatModel") ?? DEFAULTS.chatModel,
    embedModel: map.get("embedModel") ?? DEFAULTS.embedModel,
    numCtx: Number.isFinite(numCtx) ? numCtx : DEFAULTS.numCtx,
    defaultLanguage: lang === "en" || lang === "th" || lang === "auto" ? (lang as LanguagePref) : DEFAULTS.defaultLanguage,
    passages: intSetting(map.get("passages"), DEFAULTS.passages, 2, 24),
    timeoutMinutes: intSetting(map.get("timeoutMinutes"), DEFAULTS.timeoutMinutes, 1, 120),
  };
}

/** Time limit for one AI answer, from Settings (falls back to AI_REQUEST_TIMEOUT_MS). */
export function answerTimeoutMs(): number {
  try {
    return getSettings().timeoutMinutes * 60_000;
  } catch {
    return config.requestTimeoutMs;
  }
}

export function saveSettings(patch: Partial<SettingsView>): SettingsView {
  const db = getDb();
  const stmt = db.prepare(
    "INSERT INTO settings(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  );
  db.transaction(() => {
    for (const [key, value] of Object.entries(patch)) {
      if (value === undefined) continue;
      stmt.run(key, String(value));
    }
  });
  return getSettings();
}
