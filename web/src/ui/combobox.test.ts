import { describe, expect, it } from "vitest";
import { entrySearchText, filterEntries, normalizeSearchText, type KeyComboEntry } from "./combobox";

const entries: KeyComboEntry[] = [
  { kind: "key", keyId: "SubscribedKey111", badge: "subscribed", summary: "River room" },
  { kind: "key", keyId: "PinnedKey222", summary: "Pinned app" },
  { kind: "key", keyId: "HostedKey444" },
  { kind: "key", keyId: "DeltaKey999", summary: "Ian Clarke's Delta Website" },
];

describe("normalizeSearchText", () => {
  it("lowercases and strips whitespace and punctuation", () => {
    expect(normalizeSearchText("Del ta")).toBe("delta");
    expect(normalizeSearchText("Ian Clarke's Delta Website")).toBe("ianclarkesdeltawebsite");
  });
});

describe("entrySearchText", () => {
  it("normalizes key and summary together", () => {
    expect(entrySearchText({ kind: "key", keyId: "AbC", summary: "Hello World" })).toBe("abchelloworld");
  });

  it("uses key only when summary is absent", () => {
    expect(entrySearchText({ kind: "key", keyId: "AbC" })).toBe("abc");
  });
});

describe("filterEntries", () => {
  it("returns all entries when query is empty (no cap)", () => {
    const many = Array.from({ length: 105 }, (_, i) => ({
      kind: "key" as const,
      keyId: `Key${i.toString().padStart(3, "0")}`,
    }));
    const filtered = filterEntries(many, "");
    expect(filtered).toHaveLength(105);
    expect(filtered.every((e) => e.kind === "key")).toBe(true);
  });

  it("returns all entries when query normalizes to empty", () => {
    expect(filterEntries(entries, "   ---")).toEqual(entries);
  });

  it("filters case-insensitively by key id", () => {
    const filtered = filterEntries(entries, "subscribed");
    expect(filtered).toEqual([
      { kind: "key", keyId: "SubscribedKey111", badge: "subscribed", summary: "River room" },
    ]);
  });

  it("filters by cached summary text", () => {
    const filtered = filterEntries(entries, "pinned app");
    expect(filtered).toEqual([{ kind: "key", keyId: "PinnedKey222", summary: "Pinned app" }]);
  });

  it("matches spaced query against unspaced summary text", () => {
    expect(filterEntries(entries, "Del ta")).toEqual([
      { kind: "key", keyId: "DeltaKey999", summary: "Ian Clarke's Delta Website" },
    ]);
  });

  it("matches unspaced query against spaced summary text", () => {
    expect(filterEntries(entries, "riverroom")).toEqual([
      { kind: "key", keyId: "SubscribedKey111", badge: "subscribed", summary: "River room" },
    ]);
  });

  it("preserves entry ordering", () => {
    expect(filterEntries(entries, "").map((e) => e.keyId)).toEqual([
      "SubscribedKey111",
      "PinnedKey222",
      "HostedKey444",
      "DeltaKey999",
    ]);
  });

  it("uses the provided search index when present", () => {
    const entry = { kind: "key" as const, keyId: "Key1", summary: "plain summary" };
    const index = new Map([["Key1", "zebra"]]);
    expect(filterEntries([entry], "zebra", index)).toEqual([entry]);
    expect(filterEntries([entry], "z e b r a", index)).toEqual([entry]);
    expect(filterEntries([entry], "zebra")).toEqual([]);
  });
});
