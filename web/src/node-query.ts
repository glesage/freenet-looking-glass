/*
 * Native bincode-over-WebSocket contract listing (freenet-stdlib 0.8.x).
 *
 * URL: ws(s)://<host>/v1/contract/command?encodingProtocol=native
 *
 * Request: NodeQueries(NodeDiagnostics) with include_subscriptions=true and
 * empty contract_keys (all hosted) + other flags false:
 *   04 00 00 00  02 00 00 00  00 00 01  00×8  00 00 00
 * Disconnect { cause: None } = 02 00 00 00  00
 *
 * Response: Ok prefix 00 00 00 00 + HostResponse::QueryResponse 02 00 00 00 +
 * QueryResponse::NodeDiagnostics (2), then:
 *   Option<NodeInfo>, Option<NetworkInfo>,
 *   subscriptions: Vec<SubscriptionInfo> — u64 count, each 32-byte id + u64 client_id,
 *   contract_states: HashMap — u64 count, base58 key + ContractState (subscribers u32,
 *   peer ids Vec<String>, size_bytes u64; remaining fields skipped).
 *
 * SubscriptionInfo and NeighborHostingInfo query variants exist on the wire but are
 * unused/unimplemented on current nodes — not sent by this client.
 *
 * Layout is version-pinned to the node's native protocol — not covered by any
 * compatibility guarantee. Parsers validate every tag strictly.
 */

const REQ_NODE_DIAGNOSTICS = new Uint8Array([
  0x04, 0x00, 0x00, 0x00, 0x02, 0x00, 0x00, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00,
  0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
]);
const REQ_DISCONNECT = new Uint8Array([0x02, 0x00, 0x00, 0x00, 0x00]);

const RESULT_OK = 0;
const HOST_QUERY_RESPONSE = 2;
const QUERY_NODE_DIAGNOSTICS = 2;

const BASE58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

export interface NodeContractList {
  subscribed: string[];
  hosted: string[];
}

class BincodeReader {
  private offset = 0;

  constructor(private readonly buf: Uint8Array) {}

  get remaining(): number {
    return this.buf.length - this.offset;
  }

  u8(): number {
    if (this.remaining < 1) throw new Error("truncated u8");
    return this.buf[this.offset++];
  }

  u32(): number {
    if (this.remaining < 4) throw new Error("truncated u32");
    const v =
      this.buf[this.offset] |
      (this.buf[this.offset + 1] << 8) |
      (this.buf[this.offset + 2] << 16) |
      (this.buf[this.offset + 3] << 24);
    this.offset += 4;
    return v >>> 0;
  }

  u64(): number {
    if (this.remaining < 8) throw new Error("truncated u64");
    const lo = this.u32();
    const hi = this.u32();
    if (hi > 0x1fffff) throw new Error("u64 exceeds Number.MAX_SAFE_INTEGER");
    return hi * 0x1_0000_0000 + lo;
  }

  bytes(n: number): Uint8Array {
    if (n < 0 || this.remaining < n) throw new Error("truncated bytes");
    const slice = this.buf.subarray(this.offset, this.offset + n);
    this.offset += n;
    return slice;
  }

  string(): string {
    const len = this.u64();
    const raw = this.bytes(len);
    return new TextDecoder().decode(raw);
  }

  option(readSome: () => void): boolean {
    const tag = this.u8();
    if (tag === 0) return false;
    if (tag !== 1) throw new Error(`invalid option tag ${tag}`);
    readSome();
    return true;
  }
}

function expectU32(reader: BincodeReader, expected: number, label?: string): void {
  const actual = reader.u32();
  if (actual !== expected) {
    const where = label ? ` (${label})` : "";
    throw new Error(`expected u32 ${expected}, got ${actual}${where}`);
  }
}

function tryQueryResponseTag(bytes: Uint8Array): number | null {
  if (bytes.length < 12) return null;
  const r = new BincodeReader(bytes);
  if (r.u32() !== RESULT_OK) return null;
  if (r.u32() !== HOST_QUERY_RESPONSE) return null;
  return r.u32();
}

// An Err response starts with Result tag 1 (not 0=Ok). The node returns one,
// rather than NodeDiagnostics, whenever the query is rejected — most importantly
// when Looking Glass runs as a hosted contract web app: the node blocks
// NodeQueries from contracts to stop them exfiltrating peer topology, replying
// "NodeQueries is not available to contract web applications". Without this the
// caller ignored the Err and waited out the full 5s timeout. Layout for
// ErrorKind::Unhandled: u32 result tag (1), u32 ErrorKind variant, then a
// length-prefixed cause string; parsed defensively with a generic fallback.
export function tryParseErrorMessage(bytes: Uint8Array): string | null {
  if (bytes.length < 4) return null;
  const r = new BincodeReader(bytes);
  if (r.u32() === RESULT_OK) return null;
  try {
    r.u32();
    const msg = r.string();
    if (msg) return msg;
  } catch {
    /* unrecognized error layout — fall back to generic message */
  }
  return "node returned an error response";
}

function readSubscriptionEntries(r: BincodeReader): string[] {
  const count = r.u64();
  const keys: string[] = [];
  for (let i = 0; i < count; i++) {
    const id = r.bytes(32);
    r.u64();
    keys.push(base58Encode(id));
  }
  return keys;
}

function skipNodeInfo(r: BincodeReader): void {
  r.string();
  r.u8();
  r.option(() => {
    r.string();
  });
  r.option(() => {
    r.string();
  });
  r.u64();
}

function skipNetworkInfo(r: BincodeReader): void {
  const n = r.u64();
  for (let i = 0; i < n; i++) {
    r.string();
    r.string();
  }
  r.u64();
}

function skipContractState(r: BincodeReader): void {
  r.u32();
  const n = r.u64();
  for (let i = 0; i < n; i++) r.string();
  r.u64();
}

function parseNodeDiagnostics(bytes: Uint8Array): NodeContractList {
  const r = new BincodeReader(bytes);
  expectU32(r, RESULT_OK, "result");
  expectU32(r, HOST_QUERY_RESPONSE, "host response");
  expectU32(r, QUERY_NODE_DIAGNOSTICS, "query variant");

  r.option(() => skipNodeInfo(r));
  r.option(() => skipNetworkInfo(r));
  const subscribed = readSubscriptionEntries(r);

  const hostedCount = r.u64();
  const hosted: string[] = [];
  for (let i = 0; i < hostedCount; i++) {
    hosted.push(r.string());
    skipContractState(r);
  }

  return { subscribed, hosted };
}

function base58Encode(bytes: Uint8Array): string {
  let zeros = 0;
  while (zeros < bytes.length && bytes[zeros] === 0) zeros++;

  const digits: number[] = [0];
  for (let i = zeros; i < bytes.length; i++) {
    let carry = bytes[i];
    for (let j = 0; j < digits.length; j++) {
      carry += digits[j] << 8;
      digits[j] = carry % 58;
      carry = (carry / 58) | 0;
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = (carry / 58) | 0;
    }
  }

  let out = "";
  for (let i = 0; i < zeros; i++) out += BASE58_ALPHABET[0];
  for (let i = digits.length - 1; i >= 0; i--) out += BASE58_ALPHABET[digits[i]];
  return out;
}

const QUERY_TIMEOUT_MS = 5000;

function waitOpen(ws: WebSocket, timeoutMs: number): Promise<void> {
  if (ws.readyState === WebSocket.OPEN) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("websocket open timed out")), timeoutMs);
    ws.addEventListener(
      "open",
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
    ws.addEventListener(
      "error",
      () => {
        clearTimeout(timer);
        reject(new Error("websocket error"));
      },
      { once: true },
    );
  });
}

function waitMessage(ws: WebSocket, timeoutMs: number): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("websocket message timed out")), timeoutMs);
    ws.addEventListener(
      "message",
      (ev) => {
        clearTimeout(timer);
        resolve(new Uint8Array(ev.data as ArrayBuffer));
      },
      { once: true },
    );
    ws.addEventListener(
      "error",
      () => {
        clearTimeout(timer);
        reject(new Error("websocket error"));
      },
      { once: true },
    );
    ws.addEventListener(
      "close",
      () => {
        clearTimeout(timer);
        reject(new Error("websocket closed"));
      },
      { once: true },
    );
  });
}

export async function queryNodeContracts(wsUrl: string): Promise<NodeContractList> {
  const ws = new WebSocket(wsUrl);
  ws.binaryType = "arraybuffer";

  try {
    await waitOpen(ws, QUERY_TIMEOUT_MS);
    ws.send(REQ_NODE_DIAGNOSTICS);

    const deadline = Date.now() + QUERY_TIMEOUT_MS;
    while (true) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw new Error("node contract query timed out");

      const bytes = await waitMessage(ws, remaining);
      const tag = tryQueryResponseTag(bytes);
      if (tag === QUERY_NODE_DIAGNOSTICS) return parseNodeDiagnostics(bytes);
      const errMsg = tryParseErrorMessage(bytes);
      if (errMsg) throw new Error(errMsg);
    }
  } finally {
    try {
      if (ws.readyState === WebSocket.OPEN) ws.send(REQ_DISCONNECT);
    } catch {
      /* ignore */
    }
    ws.close();
  }
}
