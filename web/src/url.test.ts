import { describe, expect, it } from "vitest";
import {
  formatKeyQuery,
  keyFromHashFragment,
  readInspectedKeyFrom,
} from "./url";

const SAMPLE_KEY = "9rhuzMSn4v4AugF5FhrjuB1tGP936TaP6Dp7fXijNPUL";

describe("formatKeyQuery", () => {
  it("adds key while preserving other params", () => {
    expect(formatKeyQuery("?node=127.0.0.1:7509", SAMPLE_KEY)).toBe(
      `?node=127.0.0.1:7509&focus=${SAMPLE_KEY}`,
    );
    expect(formatKeyQuery("?node=127.0.0.1:7509&other=x", SAMPLE_KEY)).toBe(
      `?node=127.0.0.1:7509&other=x&focus=${SAMPLE_KEY}`,
    );
  });

  it("replaces an existing focus param", () => {
    expect(formatKeyQuery(`?node=127.0.0.1:7509&focus=oldKey&other=x`, "newKey")).toBe(
      "?node=127.0.0.1:7509&other=x&focus=newKey",
    );
  });

  it("clears focus when null", () => {
    expect(formatKeyQuery(`?node=127.0.0.1:7509&focus=${SAMPLE_KEY}`, null)).toBe(
      "?node=127.0.0.1:7509",
    );
    expect(formatKeyQuery("", null)).toBe("");
  });

  it("keeps foreign params byte-stable", () => {
    expect(formatKeyQuery("?invitation=abc%3D", SAMPLE_KEY)).toBe(
      `?invitation=abc%3D&focus=${SAMPLE_KEY}`,
    );
  });
});

describe("keyFromHashFragment", () => {
  it("accepts a bare contract id hash", () => {
    expect(keyFromHashFragment(`#${SAMPLE_KEY}`)).toBe(SAMPLE_KEY);
  });

  it("rejects empty, path-like, and name=value fragments", () => {
    expect(keyFromHashFragment("")).toBeNull();
    expect(keyFromHashFragment("#")).toBeNull();
    expect(keyFromHashFragment("#foo/bar")).toBeNull();
    expect(keyFromHashFragment("#river-processed=abc")).toBeNull();
  });
});

describe("readInspectedKeyFrom", () => {
  it("prefers the query param over hash", () => {
    expect(readInspectedKeyFrom(`?focus=fromQuery`, `#${SAMPLE_KEY}`)).toBe("fromQuery");
  });

  it("falls back to hash when query is absent", () => {
    expect(readInspectedKeyFrom("?node=127.0.0.1:7509", `#${SAMPLE_KEY}`)).toBe(SAMPLE_KEY);
  });

  it("returns null when neither source carries a key", () => {
    expect(readInspectedKeyFrom("?node=127.0.0.1:7509", "")).toBeNull();
    expect(readInspectedKeyFrom("", "#river-processed=abc")).toBeNull();
  });
});
