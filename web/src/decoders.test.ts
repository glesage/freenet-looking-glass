import { describe, expect, it } from "vitest";
import { cborDecode, cborKeyString } from "./cbor";
import { deepDecode } from "./decoders";

describe("cborDecode bigint support", () => {
  it("decodes uint64 max as bigint", () => {
    const bytes = Uint8Array.from([0x1b, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff]);
    expect(cborDecode(bytes)).toBe(18446744073709551615n);
  });

  it("decodes negative int beyond -2^53 as bigint", () => {
    const bytes = Uint8Array.from([0x3b, 0x7f, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff]);
    expect(cborDecode(bytes)).toBe(-9223372036854775808n);
  });

  it("keeps safe-range ints as number", () => {
    expect(cborDecode(Uint8Array.from([0x18, 0x2a]))).toBe(42);
    expect(cborDecode(Uint8Array.from([0x38, 0x63]))).toBe(-100);
  });

  it("stringifies bigint map keys sanely", () => {
    const key = 9007199254740993n;
    expect(cborKeyString(key)).toBe("9007199254740993n");
  });
});

describe("deepDecode root detection", () => {
  it("detects CBOR root", () => {
    const bytes = Uint8Array.from([
      0xa2, 0x65, 0x63, 0x6f, 0x75, 0x6e, 0x74, 0x18, 0x2a, 0x65, 0x70,
      0x65, 0x65, 0x72, 0x73, 0x82, 0x61, 0x61, 0x61, 0x62,
    ]);
    const { rootKind } = deepDecode(bytes);
    expect(rootKind).toBe("cbor");
  });

  it("detects JSON root", () => {
    const bytes = new TextEncoder().encode('{"count":42}');
    const { rootKind } = deepDecode(bytes);
    expect(rootKind).toBe("json");
  });
});
