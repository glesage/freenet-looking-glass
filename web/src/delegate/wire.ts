export enum WireOp {
  Get = 0x00,
  Set = 0x01,
}

export enum Status {
  Ok = 0x00,
  NotFound = 0x01,
  StoreFailed = 0x02,
  BadRequest = 0x03,
}

export interface DecodedResponse {
  op: WireOp;
  id: number;
  status: Status;
  blob: Uint8Array;
}

function encodeRequest(op: WireOp, id: number, blob: Uint8Array): Uint8Array {
  const out = new Uint8Array(5 + blob.length);
  out[0] = op;
  new DataView(out.buffer).setUint32(1, id, true);
  out.set(blob, 5);
  return out;
}

export function encodeGet(id: number): Uint8Array {
  return encodeRequest(WireOp.Get, id, new Uint8Array());
}

export function encodeSet(id: number, blob: Uint8Array): Uint8Array {
  return encodeRequest(WireOp.Set, id, blob);
}

export function decodeResponse(bytes: Uint8Array): DecodedResponse | null {
  if (bytes.length < 6) return null;
  const op = bytes[0];
  if (op !== WireOp.Get && op !== WireOp.Set) return null;
  const id = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(1, true);
  const status = bytes[5];
  if (
    status !== Status.Ok &&
    status !== Status.NotFound &&
    status !== Status.StoreFailed &&
    status !== Status.BadRequest
  ) {
    return null;
  }
  return {
    op: op as WireOp,
    id,
    status: status as Status,
    blob: bytes.subarray(6),
  };
}
