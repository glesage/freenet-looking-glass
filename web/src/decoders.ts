// Best-effort decoding of contract state bytes. Contract state is UNTRUSTED
// input from the network: decoders must be total (never hang, never blow the
// stack) and their output must only ever be rendered via textContent.

import { cborDecode, MAX_DEPTH } from "./cbor";
import { sha256Hex } from "./sha256";

export { cborDecode, cborKeyString, hexDump, MAX_DEPTH, toHex } from "./cbor";

export type RootDecodeKind = "webcontainer" | "json" | "cbor" | "text" | "binary";

export class DecodedBytes {
  constructor(
    readonly source: "cbor" | "json" | "text",
    readonly byteLength: number,
    readonly value: unknown,
  ) {}
}

export interface DeepDecoded {
  value: unknown;
  trace: string;
  rootKind: RootDecodeKind;
}

const utf8Strict = new TextDecoder("utf-8", { fatal: true });

const NODE_BUDGET = 50_000;
const MAX_BYTE_DECODE_SIZE = 128 * 1024;
const MAX_CONTAINER_META = 1 << 20;

const ROOT_TRACE_LABELS: Record<RootDecodeKind, string> = {
  webcontainer: "web container",
  json: "json",
  cbor: "cbor",
  text: "text",
  binary: "binary",
};

export function deepDecode(bytes: Uint8Array): DeepDecoded {
  const ctx: DecodeContext = { nodesVisited: 0, bytesDecodedCount: 0 };
  const { kind, value } = decodeRoot(bytes);
  const decoded = deepDecodeValue(value, 0, ctx);
  const trace = buildTrace(kind, ctx.bytesDecodedCount);
  return { value: decoded, trace, rootKind: kind };
}

interface DecodeContext {
  nodesVisited: number;
  bytesDecodedCount: number;
}

function buildTrace(rootKind: RootDecodeKind, nestedCount: number): string {
  const label = ROOT_TRACE_LABELS[rootKind];
  if (nestedCount === 0) return label;
  const plural = nestedCount === 1 ? "field" : "fields";
  return `${label} · ${nestedCount} nested byte ${plural} decoded`;
}

function decodeRoot(bytes: Uint8Array): { kind: RootDecodeKind; value: unknown } {
  try {
    return { kind: "webcontainer", value: decodeWebContainer(bytes) };
  } catch { /* fall through */ }

  try {
    if (bytes.length === 0) throw new Error("empty");
    const text = utf8Strict.decode(bytes);
    const first = text.trimStart()[0];
    if (!first || !'{["-0123456789tfn'.includes(first)) throw new Error("not JSON-shaped");
    return { kind: "json", value: JSON.parse(text) };
  } catch { /* fall through */ }

  try {
    return { kind: "cbor", value: cborDecode(bytes) };
  } catch { /* fall through */ }

  try {
    if (bytes.length === 0) throw new Error("empty");
    const text = utf8Strict.decode(bytes);
    let printable = 0;
    for (const ch of text) {
      const c = ch.codePointAt(0)!;
      if (c >= 0x20 || c === 0x09 || c === 0x0a || c === 0x0d) printable++;
    }
    if (printable / [...text].length < 0.9) throw new Error("mostly non-printable");
    return { kind: "text", value: text };
  } catch { /* fall through */ }

  return { kind: "binary", value: bytes };
}

function deepDecodeValue(value: unknown, depth: number, ctx: DecodeContext): unknown {
  if (ctx.nodesVisited >= NODE_BUDGET) return value;
  ctx.nodesVisited++;
  if (depth > MAX_DEPTH) return value;

  if (value instanceof Uint8Array) {
    return tryDecodeBytes(value, depth, ctx);
  }

  if (Array.isArray(value)) {
    if (isByteIntArray(value) && value.length >= 4) {
      const bytes = Uint8Array.from(value as number[]);
      return tryDecodeBytes(bytes, depth, ctx);
    }
    return value.map((item) => deepDecodeValue(item, depth + 1, ctx));
  }

  if (value !== null && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) {
      result[k] = deepDecodeValue(v, depth + 1, ctx);
    }
    annotateUnixTime(result);
    return result;
  }

  return value;
}

function tryDecodeBytes(bytes: Uint8Array, depth: number, ctx: DecodeContext): unknown {
  if (bytes.length > MAX_BYTE_DECODE_SIZE) return bytes;

  try {
    const decoded = cborDecode(bytes);
    if (isAcceptableCborResult(decoded)) {
      ctx.bytesDecodedCount++;
      const inner = deepDecodeValue(decoded, depth + 1, ctx);
      return new DecodedBytes("cbor", bytes.length, inner);
    }
  } catch { /* fall through */ }

  try {
    const text = utf8Strict.decode(bytes);
    const first = text.trimStart()[0];
    if (first && '{["-0123456789tfn'.includes(first)) {
      const parsed = JSON.parse(text);
      ctx.bytesDecodedCount++;
      const inner = deepDecodeValue(parsed, depth + 1, ctx);
      return new DecodedBytes("json", bytes.length, inner);
    }
  } catch { /* fall through */ }

  try {
    if (bytes.length >= 2) {
      const text = utf8Strict.decode(bytes);
      let printable = 0;
      for (const ch of text) {
        const c = ch.codePointAt(0)!;
        if (c >= 0x20 || c === 0x09 || c === 0x0a || c === 0x0d) printable++;
      }
      if (printable / [...text].length >= 0.9) {
        ctx.bytesDecodedCount++;
        return new DecodedBytes("text", bytes.length, text);
      }
    }
  } catch { /* fall through */ }

  return bytes;
}

function isAcceptableCborResult(v: unknown): boolean {
  if (typeof v === "string") return true;
  if (Array.isArray(v)) return true;
  return v !== null && typeof v === "object" && !(v instanceof Uint8Array);
}

function isByteIntArray(arr: unknown[]): boolean {
  return arr.every((b) => typeof b === "number" && b >= 0 && b <= 255);
}

function annotateUnixTime(obj: Record<string, unknown>): void {
  const secs = obj["secs_since_epoch"];
  if (typeof secs !== "number" && typeof secs !== "bigint") return;
  const secNum = typeof secs === "bigint" ? Number(secs) : secs;
  const nanos = obj["nanos_since_epoch"];
  const nanoNum =
    typeof nanos === "number" ? nanos : typeof nanos === "bigint" ? Number(nanos) : 0;
  const ms = secNum * 1000 + Math.floor(nanoNum / 1_000_000);
  obj["secs_since_epoch (as date)"] = new Date(ms).toISOString();
}

function decodeWebContainer(bytes: Uint8Array): unknown {
  if (bytes.length < 24) throw new Error("too short for a web container");
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  const metaLenBig = dv.getBigUint64(0);
  if (metaLenBig === 0n || metaLenBig > BigInt(MAX_CONTAINER_META)) {
    throw new Error("implausible metadata length");
  }
  const metaLen = Number(metaLenBig);
  if (8 + metaLen + 8 > bytes.length) throw new Error("metadata overruns input");

  const metadata = cborDecode(bytes.subarray(8, 8 + metaLen));

  const webLenBig = dv.getBigUint64(8 + metaLen);
  const archive = bytes.subarray(16 + metaLen);
  if (webLenBig !== BigInt(archive.length)) throw new Error("archive length mismatch");

  const isXz =
    archive.length >= 6 &&
    archive[0] === 0xfd && archive[1] === 0x37 && archive[2] === 0x7a &&
    archive[3] === 0x58 && archive[4] === 0x5a && archive[5] === 0x00;

  return {
    format: "Freenet web container (fdev website)",
    note:
      "This contract holds a website bundle (the app's UI), not its data. " +
      "App data lives in separate contracts — e.g. each River room is its own contract; " +
      "inspect the room's contract key to see its messages.",
    metadata: annotateContainerMeta(metadata),
    webapp_archive: {
      size_bytes: archive.length,
      compression: isXz ? "xz" : "unknown (no xz magic)",
      sha256: sha256Hex(archive),
    },
  };
}

function annotateContainerMeta(meta: unknown): unknown {
  if (meta === null || typeof meta !== "object" || Array.isArray(meta)) return meta;
  const out: Record<string, unknown> = { ...(meta as Record<string, unknown>) };
  const sig = out["signature"];
  if (Array.isArray(sig) && sig.length === 64 && sig.every((b) => typeof b === "number" && b >= 0 && b <= 255)) {
    out["signature"] = Uint8Array.from(sig as number[]);
  }
  const version = out["version"];
  if (typeof version === "number" && version > 1e9 && version < 4e9) {
    out["version_as_unix_time"] = new Date(version * 1000).toISOString();
  }
  return out;
}
