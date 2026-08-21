# Watchlist delegate

Looking Glass stores pinned contract keys in this delegate's encrypted secret store.

## Wire format

| Field | Layout |
|---|---|
| Request | `op:u8` · `id:u32le` · `blob:[u8]` |
| Response | `op:u8` · `id:u32le` · `status:u8` · `blob:[u8]` |

| `op` | Meaning |
|---|---|
| `0x00` | GET |
| `0x01` | SET |

| `status` | Meaning |
|---|---|
| `0x00` | OK |
| `0x01` | NOT_FOUND |
| `0x02` | STORE_FAILED |
| `0x03` | BAD_REQUEST |

GET uses an empty request blob. SET's blob is UTF-8 JSON of `WatchlistEntry[]`. Secret keys are `lg.watchlist.v1:` plus either the literal `local` (`make dev`) or the base58 hosted web-app contract id.

## Identity

```
code_hash    = BLAKE3(raw .wasm bytes)
delegate_key = BLAKE3(code_hash || params)   # params empty here
```

The browser derives both hashes from the fetched WASM at runtime. `RegisterDelegate` sends the **raw** `cargo build` artifact (not an `fdev`-packaged delegate file).

## Build

```bash
make delegate        # rebuild and copy into web/src/delegate/
make check-delegate  # fail if the committed WASM is stale
```

The committed `web/src/delegate/watchlist_delegate.wasm` keeps `npm run build` and CI TypeScript jobs Rust-free; CI's `delegate-wasm` job rebuilds and compares BLAKE3 hashes.

Build the delegate with `default = ["freenet-main-delegate"]` and `freenet-stdlib` feature `contract` so the WASM exports the Freenet host entrypoints (`process`, `__frnt__initiate_buffer`, etc.).
