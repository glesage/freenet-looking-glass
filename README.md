# Looking Glass

A read-only dashboard, published on Freenet itself, for inspecting contract
state as plain text, tables, and graphs.

**The trust story:** every byte shown is fetched by *your own node* over
localhost. There is no indexer, no central server, no API someone else runs.
Pin a contract, subscribe, and watch what your node actually holds — and
compare the SHA-256 with anyone else to confirm you're both seeing the same
bytes.

## Architecture

Looking Glass is designed to be a zero-dependency viewer with no custom contracts or delegates.

- **No custom contracts**: The UI is published as the state of a generic `fdev website` contract. It defines no shared state of its own, avoiding contract re-key risks and migration complexity.
- **No delegates**: No secrets or background tasks. Per-user state (like the watchlist) is stored in `localStorage` with in-memory fallbacks to handle gateway sandbox restrictions.
- **Connection Model**: Uses one `FreenetWsApi` WebSocket per tab. To list node contracts, it briefly opens a second transient socket using the native bincode protocol to bypass current SDK limitations.
- **Recursive Decoding**: State bytes are decoded best-effort in layers (Web Container → JSON → CBOR → UTF-8). A recursive pass attempts to decode every byte field as nested data, rendering a unified, lazy-loaded tree.
- **Trust & Safety**: All rendering uses `textContent` to treat contract state as untrusted input. SHA-256 hashes are computed in-app so users can verify state consistency across nodes.

## Features

- **Inspect any contract**: GET raw state by Base58 key. Focus is reflected in the URL for bookmarking.
- **Live subscribe**: Watch updates in real-time. An SVG timeline (hand-rolled to keep the bundle small) charts update sizes.
- **Contract-key combobox**: A virtualized list of every contract your node hosts, with fuzzy filtering and preview.
- **Watchlist**: Pin contracts for quick access.

## Develop

Requires a local Freenet node (default ws-api `127.0.0.1:7509`).

```bash
make dev        # vite dev server → http://127.0.0.1:5173/?node=127.0.0.1:7509
make test       # unit tests + live-node e2e
```

## Publish

```bash
fdev website init freenet-looking-glass   # ONCE — prints your permanent URL
# ⚠ BACK UP THE SIGNING KEY: ~/Library/Application Support/freenet/website-keys/
make publish    # v1
make update     # every release after
```

## Reading River rooms

River's UI is a website bundle, but each **room** is a separate contract. To inspect a room:
1. Copy the contract key from the River invite URL.
2. Paste it into Looking Glass.
The recursive pipeline will automatically surface public message text and timestamps from the nested CBOR state.

## Known limits (v1)

- **Read-only**: No PUT/UPDATE path exists by design.
- **Unvouched state**: The node returns what it holds; it does not vouch for validity.
- **Generic views**: App-specific presentation is handled via the agnostic tree; no per-app custom decoders.
