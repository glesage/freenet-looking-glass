/// <reference types="node" />
import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { describe, expect, it } from "vitest";
import { deriveDelegateIdentity } from "./keys";

const wasmPath = join(dirname(fileURLToPath(import.meta.url)), "watchlist_delegate.wasm");

function hex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

describe("deriveDelegateIdentity", () => {
  it("returns 32-byte code hash and delegate key", () => {
    const wasm = readFileSync(wasmPath);
    const { key, codeHash } = deriveDelegateIdentity(new Uint8Array(wasm));
    expect(codeHash).toHaveLength(32);
    expect(key).toHaveLength(32);
  });

  it("derives a different key than code hash for the same wasm", () => {
    const wasm = readFileSync(wasmPath);
    const { key, codeHash } = deriveDelegateIdentity(new Uint8Array(wasm));
    expect(hex(key)).not.toBe(hex(codeHash));
  });

  it("matches the committed wasm fixture", () => {
    const wasm = readFileSync(wasmPath);
    const { key, codeHash } = deriveDelegateIdentity(new Uint8Array(wasm));
    expect(hex(codeHash)).toBe("7306874ca6a26bcab9eb50f3298d6ceaae9b6e6b178a26e278f80e99082ff305");
    expect(hex(key)).toBe("1365254a3439902a595164f8c4d7b48fd5b8a760d8ad4c0424acc40f9b6303c5");
  });
});
