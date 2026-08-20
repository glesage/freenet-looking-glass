import { DecodedBytes } from "./decoders";
import { toHex } from "./cbor";

export interface DiffEntry {
  path: string;
  op: "added" | "removed" | "changed";
  before?: string;
  after?: string;
}

const MAX_DEPTH = 32;
const MAX_ENTRIES = 200;
const MAX_VALUE_LEN = 160;
const TRUNCATION_PATH = "… (truncated)";

interface DiffContext {
  entries: DiffEntry[];
  remaining: number;
  truncated: boolean;
}

export function diffDecoded(before: unknown, after: unknown): DiffEntry[] {
  const ctx: DiffContext = { entries: [], remaining: MAX_ENTRIES, truncated: false };
  diffValues(before, after, "", ctx, 0);
  if (ctx.truncated) {
    ctx.entries.push({ path: TRUNCATION_PATH, op: "changed" });
  }
  return ctx.entries;
}

export function diffSummary(entries: DiffEntry[]): string {
  if (entries.length === 0) return "no change";
  let added = 0;
  let changed = 0;
  let removed = 0;
  for (const entry of entries) {
    if (entry.path === TRUNCATION_PATH) continue;
    if (entry.op === "added") added++;
    else if (entry.op === "changed") changed++;
    else removed++;
  }
  return `+${added} ~${changed} −${removed}`;
}

function diffValues(before: unknown, after: unknown, path: string, ctx: DiffContext, depth: number): void {
  if (ctx.remaining <= 0) {
    ctx.truncated = true;
    return;
  }
  if (depth > MAX_DEPTH) return;

  before = unwrap(before);
  after = unwrap(after);

  if (valuesEqual(before, after)) return;

  const beforeScalar = isScalar(before);
  const afterScalar = isScalar(after);

  if (beforeScalar && afterScalar) {
    pushEntry(ctx, { path, op: "changed", before: formatValue(before), after: formatValue(after) });
    return;
  }

  if (beforeScalar && !afterScalar) {
    pushRemoved(before, path, ctx, depth);
    pushAdded(after, path, ctx, depth + 1);
    return;
  }

  if (!beforeScalar && afterScalar) {
    pushRemoved(before, path, ctx, depth);
    pushAdded(after, path, ctx, depth + 1);
    return;
  }

  if (Array.isArray(before) && Array.isArray(after)) {
    diffArrays(before, after, path, ctx, depth + 1);
    return;
  }

  if (isPlainObject(before) && isPlainObject(after)) {
    diffObjects(before, after, path, ctx, depth + 1);
    return;
  }

  pushEntry(ctx, { path, op: "changed", before: formatValue(before), after: formatValue(after) });
}

function diffArrays(before: unknown[], after: unknown[], path: string, ctx: DiffContext, depth: number): void {
  const shared = Math.min(before.length, after.length);
  for (let i = 0; i < shared; i++) {
    diffValues(before[i], after[i], joinPath(path, i), ctx, depth);
  }
  for (let i = shared; i < before.length; i++) {
    pushRemoved(before[i], joinPath(path, i), ctx, depth);
  }
  for (let i = shared; i < after.length; i++) {
    pushAdded(after[i], joinPath(path, i), ctx, depth);
  }
}

function diffObjects(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  path: string,
  ctx: DiffContext,
  depth: number,
): void {
  const beforeKeys = Object.keys(before);
  const afterKeys = Object.keys(after);
  const afterSet = new Set(afterKeys);

  for (const key of beforeKeys) {
    const childPath = joinPath(path, key);
    if (!afterSet.has(key)) {
      pushRemoved(before[key], childPath, ctx, depth);
    } else {
      diffValues(before[key], after[key], childPath, ctx, depth);
    }
  }

  const beforeSet = new Set(beforeKeys);
  for (const key of afterKeys) {
    if (!beforeSet.has(key)) {
      pushAdded(after[key], joinPath(path, key), ctx, depth);
    }
  }
}

function pushAdded(value: unknown, path: string, ctx: DiffContext, depth: number): void {
  value = unwrap(value);
  if (ctx.remaining <= 0) {
    ctx.truncated = true;
    return;
  }
  if (depth > MAX_DEPTH) return;

  if (isScalar(value)) {
    pushEntry(ctx, { path, op: "added", after: formatValue(value) });
    return;
  }

  if (Array.isArray(value)) {
    if (value.length === 0) {
      pushEntry(ctx, { path, op: "added", after: "[] (empty)" });
      return;
    }
    for (let i = 0; i < value.length; i++) {
      pushAdded(value[i], joinPath(path, i), ctx, depth + 1);
    }
    return;
  }

  if (isPlainObject(value)) {
    const keys = Object.keys(value);
    if (keys.length === 0) {
      pushEntry(ctx, { path, op: "added", after: "{} (0 fields)" });
      return;
    }
    for (const key of keys) {
      pushAdded(value[key], joinPath(path, key), ctx, depth + 1);
    }
  }
}

function pushRemoved(value: unknown, path: string, ctx: DiffContext, depth: number): void {
  value = unwrap(value);
  if (ctx.remaining <= 0) {
    ctx.truncated = true;
    return;
  }
  if (depth > MAX_DEPTH) return;

  if (isScalar(value)) {
    pushEntry(ctx, { path, op: "removed", before: formatValue(value) });
    return;
  }

  if (Array.isArray(value)) {
    if (value.length === 0) {
      pushEntry(ctx, { path, op: "removed", before: "[] (empty)" });
      return;
    }
    for (let i = 0; i < value.length; i++) {
      pushRemoved(value[i], joinPath(path, i), ctx, depth + 1);
    }
    return;
  }

  if (isPlainObject(value)) {
    const keys = Object.keys(value);
    if (keys.length === 0) {
      pushEntry(ctx, { path, op: "removed", before: "{} (0 fields)" });
      return;
    }
    for (const key of keys) {
      pushRemoved(value[key], joinPath(path, key), ctx, depth + 1);
    }
  }
}

function pushEntry(ctx: DiffContext, entry: DiffEntry): void {
  if (ctx.remaining <= 0) {
    ctx.truncated = true;
    return;
  }
  ctx.entries.push(entry);
  ctx.remaining--;
}

function joinPath(base: string, segment: string | number): string {
  if (typeof segment === "number") {
    return base === "" ? `[${segment}]` : `${base}[${segment}]`;
  }
  return base === "" ? segment : `${base}.${segment}`;
}

function unwrap(value: unknown): unknown {
  if (value instanceof DecodedBytes) return value.value;
  return value;
}

function isScalar(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (value instanceof Uint8Array) return true;
  const t = typeof value;
  return t === "string" || t === "number" || t === "bigint" || t === "boolean";
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) && !(value instanceof Uint8Array);
}

function valuesEqual(a: unknown, b: unknown): boolean {
  a = unwrap(a);
  b = unwrap(b);

  const aNumLike = typeof a === "bigint" || typeof a === "number";
  const bNumLike = typeof b === "bigint" || typeof b === "number";
  if (aNumLike && bNumLike) return String(a) === String(b);

  if (a instanceof Uint8Array && b instanceof Uint8Array) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (a[i] !== b[i]) return false;
    }
    return true;
  }
  if (a instanceof Uint8Array || b instanceof Uint8Array) return false;

  return Object.is(a, b);
}

function formatValue(value: unknown): string {
  return truncate(formatValueRaw(value));
}

function formatValueRaw(value: unknown): string {
  value = unwrap(value);
  if (value === null) return "null";
  if (value === undefined) return "undefined";

  switch (typeof value) {
    case "boolean":
    case "number":
    case "bigint":
      return String(value);
    case "string":
      return JSON.stringify(value);
  }

  if (value instanceof Uint8Array) {
    return `bytes[${value.length}] 0x${toHex(value, 24)}`;
  }

  if (Array.isArray(value)) {
    return value.length === 0 ? "[] (empty)" : `[] (${value.length} items)`;
  }

  if (isPlainObject(value)) {
    const count = Object.keys(value).length;
    return count === 0 ? "{} (0 fields)" : `{} (${count} fields)`;
  }

  return String(value);
}

function truncate(text: string): string {
  if (text.length <= MAX_VALUE_LEN) return text;
  return `${text.slice(0, MAX_VALUE_LEN)}…`;
}
