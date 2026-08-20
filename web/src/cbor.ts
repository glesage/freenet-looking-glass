// Minimal CBOR decoder (RFC 8949). Self-contained on purpose: no dependency
// drift, and small enough to audit. Tags are unwrapped to their inner value.

const utf8Strict = new TextDecoder("utf-8", { fatal: true });

export const MAX_DEPTH = 64;

export function cborDecode(bytes: Uint8Array): unknown {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const state = { pos: 0 };
  const value = item(bytes, view, state, 0);
  if (state.pos !== bytes.length) throw new Error("trailing bytes after CBOR item");
  return value;
}

function need(bytes: Uint8Array, state: { pos: number }, n: number): void {
  if (state.pos + n > bytes.length) throw new Error("truncated CBOR");
}

function readLen(
  bytes: Uint8Array,
  view: DataView,
  state: { pos: number },
  info: number,
): number | null {
  if (info < 24) return info;
  if (info === 24) { need(bytes, state, 1); return view.getUint8(state.pos++); }
  if (info === 25) { need(bytes, state, 2); const v = view.getUint16(state.pos); state.pos += 2; return v; }
  if (info === 26) { need(bytes, state, 4); const v = view.getUint32(state.pos); state.pos += 4; return v; }
  if (info === 27) {
    need(bytes, state, 8);
    const v = view.getBigUint64(state.pos); state.pos += 8;
    if (v > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("length too large");
    return Number(v);
  }
  if (info === 31) return null;
  throw new Error(`invalid additional info ${info}`);
}

function readIntValue(
  bytes: Uint8Array,
  view: DataView,
  state: { pos: number },
  info: number,
  negative: boolean,
): number | bigint {
  if (info < 24) {
    const v = info;
    return negative ? -1 - v : v;
  }
  if (info === 24) {
    need(bytes, state, 1);
    const v = view.getUint8(state.pos++);
    return negative ? -1 - v : v;
  }
  if (info === 25) {
    need(bytes, state, 2);
    const v = view.getUint16(state.pos); state.pos += 2;
    return negative ? -1 - v : v;
  }
  if (info === 26) {
    need(bytes, state, 4);
    const v = view.getUint32(state.pos); state.pos += 4;
    return negative ? -1 - v : v;
  }
  if (info === 27) {
    need(bytes, state, 8);
    const v = view.getBigUint64(state.pos); state.pos += 8;
    const signed = negative ? -1n - v : v;
    if (
      signed > BigInt(Number.MAX_SAFE_INTEGER) ||
      signed < BigInt(Number.MIN_SAFE_INTEGER)
    ) {
      return signed;
    }
    return Number(signed);
  }
  if (info === 31) throw new Error("indefinite integer");
  throw new Error(`invalid additional info ${info}`);
}

function item(
  bytes: Uint8Array,
  view: DataView,
  state: { pos: number },
  depth: number,
): unknown {
  if (depth > MAX_DEPTH) throw new Error("nesting too deep");
  need(bytes, state, 1);
  const initial = bytes[state.pos++];
  const major = initial >> 5;
  const info = initial & 0x1f;

  switch (major) {
    case 0:
      return readIntValue(bytes, view, state, info, false);
    case 1:
      return readIntValue(bytes, view, state, info, true);
    case 2: {
      const len = readLen(bytes, view, state, info);
      if (len === null) return concatChunks(bytes, view, state, depth, 2);
      need(bytes, state, len);
      const out = bytes.slice(state.pos, state.pos + len);
      state.pos += len;
      return out;
    }
    case 3: {
      const len = readLen(bytes, view, state, info);
      if (len === null) {
        const chunks = concatChunks(bytes, view, state, depth, 3);
        return utf8Strict.decode(chunks as Uint8Array);
      }
      need(bytes, state, len);
      const out = utf8Strict.decode(bytes.subarray(state.pos, state.pos + len));
      state.pos += len;
      return out;
    }
    case 4: {
      const len = readLen(bytes, view, state, info);
      const arr: unknown[] = [];
      if (len === null) {
        while (!atBreak(bytes, state)) arr.push(item(bytes, view, state, depth + 1));
      } else {
        if (len > bytes.length - state.pos) throw new Error("array length exceeds input");
        for (let i = 0; i < len; i++) arr.push(item(bytes, view, state, depth + 1));
      }
      return arr;
    }
    case 5: {
      const len = readLen(bytes, view, state, info);
      const obj: Record<string, unknown> = {};
      const add = () => {
        const k = item(bytes, view, state, depth + 1);
        const v = item(bytes, view, state, depth + 1);
        obj[typeof k === "string" ? k : cborKeyString(k)] = v;
      };
      if (len === null) {
        while (!atBreak(bytes, state)) add();
      } else {
        if (len > (bytes.length - state.pos) / 2) throw new Error("map length exceeds input");
        for (let i = 0; i < len; i++) add();
      }
      return obj;
    }
    case 6: {
      const tag = readLen(bytes, view, state, info);
      if (tag === null) throw new Error("indefinite tag");
      return item(bytes, view, state, depth + 1);
    }
    case 7: {
      if (info === 20) return false;
      if (info === 21) return true;
      if (info === 22) return null;
      if (info === 23) return undefined;
      if (info === 24) { need(bytes, state, 1); return bytes[state.pos++]; }
      if (info === 25) { need(bytes, state, 2); const v = halfFloat(view.getUint16(state.pos)); state.pos += 2; return v; }
      if (info === 26) { need(bytes, state, 4); const v = view.getFloat32(state.pos); state.pos += 4; return v; }
      if (info === 27) { need(bytes, state, 8); const v = view.getFloat64(state.pos); state.pos += 8; return v; }
      if (info === 31) throw new Error("unexpected break");
      throw new Error(`unsupported simple/float info ${info}`);
    }
    default:
      throw new Error(`unsupported major type ${major}`);
  }
}

function atBreak(bytes: Uint8Array, state: { pos: number }): boolean {
  if (state.pos >= bytes.length) throw new Error("truncated indefinite item");
  if (bytes[state.pos] === 0xff) { state.pos++; return true; }
  return false;
}

function concatChunks(
  bytes: Uint8Array,
  view: DataView,
  state: { pos: number },
  depth: number,
  expectMajor: number,
): Uint8Array {
  const parts: Uint8Array[] = [];
  while (!atBreak(bytes, state)) {
    if (bytes[state.pos] >> 5 !== expectMajor) throw new Error("mixed chunk types");
    const chunk = item(bytes, view, state, depth + 1);
    parts.push(
      chunk instanceof Uint8Array ? chunk : new TextEncoder().encode(chunk as string),
    );
  }
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) { out.set(p, off); off += p.length; }
  return out;
}

export function cborKeyString(k: unknown): string {
  if (k instanceof Uint8Array) return `0x${toHex(k, 32)}`;
  if (typeof k === "bigint") return `${k}n`;
  try { return JSON.stringify(k) ?? String(k); } catch { return String(k); }
}

function halfFloat(h: number): number {
  const sign = h & 0x8000 ? -1 : 1;
  const exp = (h >> 10) & 0x1f;
  const frac = h & 0x3ff;
  if (exp === 0) return sign * frac * 2 ** -24;
  if (exp === 31) return frac ? NaN : sign * Infinity;
  return sign * (1 + frac / 1024) * 2 ** (exp - 15);
}

export function toHex(bytes: Uint8Array, max = Infinity): string {
  let out = "";
  const n = Math.min(bytes.length, max);
  for (let i = 0; i < n; i++) out += bytes[i].toString(16).padStart(2, "0");
  if (bytes.length > max) out += "…";
  return out;
}

export function hexDump(bytes: Uint8Array, maxBytes = 4096): string {
  const n = Math.min(bytes.length, maxBytes);
  const lines: string[] = [];
  for (let off = 0; off < n; off += 16) {
    const row = bytes.subarray(off, Math.min(off + 16, n));
    const hex = [...row].map((b) => b.toString(16).padStart(2, "0"));
    while (hex.length < 16) hex.push("  ");
    const ascii = [...row]
      .map((b) => (b >= 0x20 && b < 0x7f ? String.fromCharCode(b) : "."))
      .join("");
    lines.push(
      `${off.toString(16).padStart(8, "0")}  ${hex.slice(0, 8).join(" ")}  ${hex
        .slice(8)
        .join(" ")}  |${ascii}|`,
    );
  }
  if (bytes.length > maxBytes) {
    lines.push(`… ${bytes.length - maxBytes} more bytes (${bytes.length} total)`);
  }
  return lines.join("\n");
}
