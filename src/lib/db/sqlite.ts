import { createRequire } from "node:module";

/**
 * A tiny adapter over two SQLite drivers so the app installs cleanly on any laptop:
 *  1. better-sqlite3 (optional dependency, prebuilt native binaries), or
 *  2. node:sqlite (built into Node.js 22.13+), used when better-sqlite3 is unavailable.
 * Only positional `?` parameters are used so both drivers behave the same.
 */

export type SqlValue = string | number | bigint | null | Uint8Array;

export interface RunResult {
  changes: number;
  lastInsertRowid: number;
}

export interface Statement {
  run(...params: unknown[]): RunResult;
  get<T = Record<string, unknown>>(...params: unknown[]): T | undefined;
  all<T = Record<string, unknown>>(...params: unknown[]): T[];
}

export interface Database {
  readonly driver: "better-sqlite3" | "node:sqlite";
  prepare(sql: string): Statement;
  exec(sql: string): void;
  transaction<T>(fn: () => T): T;
  close(): void;
}

function normalize(params: unknown[]): SqlValue[] {
  return params.map((p) => {
    if (p === undefined || p === null) return null;
    if (typeof p === "boolean") return p ? 1 : 0;
    if (p instanceof Uint8Array) return p;
    if (typeof p === "number" || typeof p === "string" || typeof p === "bigint") return p;
    return JSON.stringify(p);
  });
}

function toNumber(value: number | bigint): number {
  return typeof value === "bigint" ? Number(value) : value;
}

// Use a runtime require so bundlers never try to resolve the optional native module.
const runtimeRequire = createRequire(import.meta.url);

interface RawStatement {
  run(...params: SqlValue[]): { changes: number | bigint; lastInsertRowid: number | bigint };
  get(...params: SqlValue[]): unknown;
  all(...params: SqlValue[]): unknown[];
}

interface RawDb {
  prepare(sql: string): RawStatement;
  exec(sql: string): void;
  close(): void;
}

function wrap(raw: RawDb, driver: Database["driver"]): Database {
  const cache = new Map<string, Statement>();
  let depth = 0;

  const db: Database = {
    driver,
    prepare(sql) {
      const cached = cache.get(sql);
      if (cached) return cached;
      const stmt = raw.prepare(sql);
      const wrapped: Statement = {
        run: (...params) => {
          const r = stmt.run(...normalize(params));
          return { changes: toNumber(r.changes), lastInsertRowid: toNumber(r.lastInsertRowid) };
        },
        get: <T>(...params: unknown[]) => (stmt.get(...normalize(params)) ?? undefined) as T | undefined,
        all: <T>(...params: unknown[]) => stmt.all(...normalize(params)) as T[],
      };
      cache.set(sql, wrapped);
      return wrapped;
    },
    exec: (sql) => raw.exec(sql),
    transaction<T>(fn: () => T): T {
      // Nested calls join the outer transaction.
      if (depth > 0) return fn();
      depth++;
      raw.exec("BEGIN IMMEDIATE");
      try {
        const result = fn();
        raw.exec("COMMIT");
        return result;
      } catch (error) {
        raw.exec("ROLLBACK");
        throw error;
      } finally {
        depth--;
      }
    },
    close: () => raw.close(),
  };
  return db;
}

export function openDatabase(file: string): Database {
  let firstError: unknown;
  if (process.env.GENAI_SQLITE_DRIVER !== "node") {
    try {
      const BetterSqlite = runtimeRequire("better-sqlite3") as new (file: string) => RawDb;
      return wrap(new BetterSqlite(file), "better-sqlite3");
    } catch (error) {
      firstError = error;
    }
  }
  try {
    const { DatabaseSync } = runtimeRequire("node:sqlite") as { DatabaseSync: new (file: string) => RawDb };
    return wrap(new DatabaseSync(file), "node:sqlite");
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    const first = firstError instanceof Error ? ` (better-sqlite3: ${firstError.message})` : "";
    throw new Error(
      `No SQLite driver is available. Use Node.js 22.13 or newer, or run "npm install better-sqlite3". Details: ${detail}${first}`,
    );
  }
}

export function toFloat32(blob: unknown): Float32Array | null {
  if (!blob) return null;
  if (blob instanceof Uint8Array) {
    const copy = blob.buffer.slice(blob.byteOffset, blob.byteOffset + blob.byteLength);
    return new Float32Array(copy);
  }
  return null;
}

export function fromFloat32(vector: number[] | Float32Array): Uint8Array {
  const f32 = vector instanceof Float32Array ? vector : Float32Array.from(vector);
  return new Uint8Array(f32.buffer, f32.byteOffset, f32.byteLength);
}
