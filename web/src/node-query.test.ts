import { describe, expect, it } from "vitest";
import { tryParseErrorMessage } from "./node-query";

// Builds the wire bytes for Err(ClientError::Unhandled { cause }): Result tag 1,
// ErrorKind variant, then a bincode length-prefixed string. Mirrors the layout
// a node emits when it rejects a NodeQueries request from a contract web app.
function encodeUnhandledError(cause: string): Uint8Array {
  const causeBytes = new TextEncoder().encode(cause);
  const buf = new Uint8Array(4 + 4 + 8 + causeBytes.length);
  const dv = new DataView(buf.buffer);
  dv.setUint32(0, 1, true); // Result::Err
  dv.setUint32(4, 6, true); // ErrorKind::Unhandled variant
  dv.setBigUint64(8, BigInt(causeBytes.length), true);
  buf.set(causeBytes, 16);
  return buf;
}

describe("tryParseErrorMessage", () => {
  it("extracts the node's cause string from an Err response", () => {
    const msg = "NodeQueries is not available to contract web applications";
    expect(tryParseErrorMessage(encodeUnhandledError(msg))).toBe(msg);
  });

  it("returns null for an Ok response (Result tag 0)", () => {
    const ok = new Uint8Array([0, 0, 0, 0, 2, 0, 0, 0, 2, 0, 0, 0]);
    expect(tryParseErrorMessage(ok)).toBeNull();
  });

  it("returns null for too-short input", () => {
    expect(tryParseErrorMessage(new Uint8Array([1, 0]))).toBeNull();
  });

  it("falls back to a generic message when the cause string is unparseable", () => {
    // Result::Err tag, then a truncated body the string reader can't decode.
    const bytes = new Uint8Array([1, 0, 0, 0, 6, 0, 0, 0, 0xff]);
    expect(tryParseErrorMessage(bytes)).toBe("node returned an error response");
  });
});
