import { describe, expect, it } from "vitest";
import { decodeResponse, encodeGet, encodeSet, Status, WireOp } from "./wire";

describe("delegate wire codec", () => {
  it("encodes GET round-trip via decodeResponse on a synthetic response", () => {
    const req = encodeGet(7);
    expect(req).toEqual(Uint8Array.from([0x00, 7, 0, 0, 0]));
  });

  it("encodes SET with a non-empty blob", () => {
    const blob = new TextEncoder().encode("hello");
    const req = encodeSet(42, blob);
    expect(Array.from(req)).toEqual([0x01, 42, 0, 0, 0, ...blob]);
  });

  it("rejects truncated response input", () => {
    expect(decodeResponse(Uint8Array.from([0x00, 1, 2, 3, 4]))).toBeNull();
  });

  it("rejects unknown op byte in response", () => {
    expect(decodeResponse(Uint8Array.from([0xff, 0, 0, 0, 0, Status.Ok]))).toBeNull();
  });

  it("matches Rust cross-language SET fixture", () => {
    const blob = new TextEncoder().encode("hello");
    const req = encodeSet(42, blob);
    const hex = Array.from(req)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
    expect(hex).toBe("012a00000068656c6c6f");
  });

  it("decodes a full response frame", () => {
    const blob = new TextEncoder().encode("[]");
    const frame = new Uint8Array(6 + blob.length);
    frame[0] = WireOp.Get;
    new DataView(frame.buffer).setUint32(1, 9, true);
    frame[5] = Status.Ok;
    frame.set(blob, 6);
    expect(decodeResponse(frame)).toEqual({
      op: WireOp.Get,
      id: 9,
      status: Status.Ok,
      blob,
    });
  });
});
