import { blake3 } from "@noble/hashes/blake3.js";

export interface DelegateIdentity {
  key: Uint8Array;
  codeHash: Uint8Array;
}

export function deriveDelegateIdentity(
  wasm: Uint8Array,
  params: Uint8Array = new Uint8Array(),
): DelegateIdentity {
  const codeHash = blake3(wasm);
  const key = blake3(new Uint8Array([...codeHash, ...params]));
  return { key, codeHash };
}
