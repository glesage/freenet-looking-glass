import { describe, expect, it } from "vitest";
import { DecodedBytes } from "./decoders";
import { diffDecoded, diffSummary } from "./state-diff";

describe("diffDecoded", () => {
  it("reports a scalar change at a nested path", () => {
    const entries = diffDecoded({ a: { b: 1 } }, { a: { b: 2 } });
    expect(entries).toEqual([
      { path: "a.b", op: "changed", before: "1", after: "2" },
    ]);
  });

  it("reports key added and removed on an object", () => {
    const before = { keep: 1, gone: 2 };
    const after = { keep: 1, fresh: 3 };
    const entries = diffDecoded(before, after);
    expect(entries).toContainEqual({ path: "gone", op: "removed", before: "2" });
    expect(entries).toContainEqual({ path: "fresh", op: "added", after: "3" });
  });

  it("reports array append as added entries at the new index", () => {
    const entries = diffDecoded({ items: ["a", "b"] }, { items: ["a", "b", "c"] });
    expect(entries).toEqual([{ path: "items[2]", op: "added", after: '"c"' }]);
  });

  it("reports prepend as changed entries at every shifted index", () => {
    const entries = diffDecoded({ items: ["a", "b", "c"] }, { items: ["z", "a", "b", "c"] });
    expect(entries).toEqual([
      { path: "items[0]", op: "changed", before: '"a"', after: '"z"' },
      { path: "items[1]", op: "changed", before: '"b"', after: '"a"' },
      { path: "items[2]", op: "changed", before: '"c"', after: '"b"' },
      { path: "items[3]", op: "added", after: '"c"' },
    ]);
  });

  it("recurses into added objects to emit leaf entries", () => {
    const entries = diffDecoded({ messages: [] }, { messages: [{ content: "hi", author: "x" }] });
    expect(entries).toEqual([
      { path: "messages[0].content", op: "added", after: '"hi"' },
      { path: "messages[0].author", op: "added", after: '"x"' },
    ]);
  });

  it("unwraps DecodedBytes before comparing", () => {
    const wrapped = new DecodedBytes("cbor", 5, { a: 1 });
    const entries = diffDecoded(wrapped, { a: 2 });
    expect(entries).toEqual([{ path: "a", op: "changed", before: "1", after: "2" }]);
  });

  it("compares Uint8Array values bytewise", () => {
    const same = diffDecoded(new Uint8Array([1, 2, 3]), new Uint8Array([1, 2, 3]));
    expect(same).toEqual([]);

    const different = diffDecoded(new Uint8Array([1, 2, 3]), new Uint8Array([1, 2, 4]));
    expect(different).toEqual([
      {
        path: "",
        op: "changed",
        before: "bytes[3] 0x010203",
        after: "bytes[3] 0x010204",
      },
    ]);
  });

  it("treats bigint and number as equal when String values match", () => {
    expect(diffDecoded({ n: 1 }, { n: 1n })).toEqual([]);
  });

  it("returns no entries for identical inputs", () => {
    const value = { a: [1, { b: "x" }], c: true };
    expect(diffDecoded(value, structuredClone(value))).toEqual([]);
  });

  it("caps entries at 200 plus a truncation marker", () => {
    const before: Record<string, number> = {};
    const after: Record<string, number> = {};
    for (let i = 0; i < 300; i++) {
      before[`k${i}`] = i;
      after[`k${i}`] = i + 1;
    }
    const entries = diffDecoded(before, after);
    expect(entries).toHaveLength(201);
    expect(entries.slice(0, 200).every((e) => e.op === "changed")).toBe(true);
    expect(entries[200]).toEqual({ path: "… (truncated)", op: "changed" });
  });

  it("does not throw on deep structures beyond the depth cap", () => {
    let deep: Record<string, unknown> = { leaf: 1 };
    for (let i = 0; i < 40; i++) {
      deep = { nested: deep };
    }
    const changed = structuredClone(deep);
    (changed as { nested: Record<string, unknown> }).nested = { leaf: 2 };
    expect(() => diffDecoded(deep, changed)).not.toThrow();
  });

  it("truncates formatted values to 160 characters", () => {
    const long = "x".repeat(200);
    const entries = diffDecoded({ s: "a" }, { s: long });
    expect(entries).toHaveLength(1);
    expect(entries[0]!.after!.length).toBe(161);
    expect(entries[0]!.after!.endsWith("…")).toBe(true);
  });
});

describe("diffSummary", () => {
  it("formats mixed operations", () => {
    expect(
      diffSummary([
        { path: "a", op: "added", after: "1" },
        { path: "b", op: "added", after: "2" },
        { path: "c", op: "changed", before: "1", after: "2" },
      ]),
    ).toBe("+2 ~1 −0");
  });

  it("returns no change for an empty diff", () => {
    expect(diffSummary([])).toBe("no change");
  });
});
