import "./style.css";
import { summaryFromDecoded } from "./contract-summary";
import { NodeClient, type ContractEntry, type ContractListing, type UpdateEvent } from "./freenet";
import { deepDecode, type DeepDecoded } from "./decoders";
import { el, renderRoot, renderRowsTable } from "./ui/render";
import { formatBytes } from "./ui/format-bytes";
import { attachCombobox, type KeyComboEntry } from "./ui/combobox";
import { loadJson, saveJson, storageIsPersistent } from "./storage";
import { sha256Hex } from "./sha256";
import { readInspectedKey, writeInspectedKey } from "./url";

interface Inspection {
  keyId: string;
  bytes: Uint8Array | null;
  sha: string;
  fetchedAt: number;
  subscribed: boolean;
  subscribePending: boolean;
  deep: DeepDecoded | null;
  updates: UpdateEvent[];
  error?: string;
}

const MAX_UPDATES_KEPT = 200;
const SUBSCRIBE_TIMEOUT_MS = 30_000;
const WATCHLIST_KEY = "looking-glass.watchlist.v2";
const WATCHLIST_KEY_V1 = "looking-glass.watchlist.v1";
const SUMMARY_CACHE_KEY = "looking-glass.combo-summaries.v1";
const CONTRACT_CACHE_TTL_MS = 30_000;

interface WatchlistEntry {
  keyId: string;
  name: string;
}

const client = new NodeClient();
const inspections = new Map<string, Inspection>();
let watchlist: WatchlistEntry[] = loadWatchlist();
let currentKey: string | null = null;
let connStatus = "connecting";
let connDetail = "";
let contractCache: { at: number; listing: ContractListing } | null = null;
let summaryCache: Record<string, string> = loadJson<Record<string, string>>(SUMMARY_CACHE_KEY, {});
let summaryPrefetchRunning = false;

// --- static layout ---------------------------------------------------------

const root = document.getElementById("app")!;
const header = el("header");
const headerLeft = el("div", "header-left");
const headerRight = el("div", "header-right");
const title = el("h1", "header-title", "Looking Glass");
headerLeft.appendChild(title);
const statusPill = el("span", "badge status-pill", "connecting…");
headerRight.appendChild(statusPill);
header.append(headerLeft, headerRight);

const tagline = el(
  "p",
  "tagline",
  "Inspect what your own node holds: raw contract state, decoded into text, tables, and graphs.",
);

const layout = el("main", "layout");
const sidebar = el("aside", "sidebar card");
const content = el("section", "content");
layout.append(sidebar, content);

const inspectCard = el("div", "inspect-card card");
const form = el("form", "key-form");
const keyInput = el("input", "key-input") as HTMLInputElement;
keyInput.placeholder = "Contract key";
keyInput.setAttribute("aria-label", "Contract key");
const inspectBtn = el("button", undefined, "Focus");
inspectBtn.type = "submit";
form.append(keyInput, inspectBtn);
inspectCard.appendChild(form);

const panel = el("div", "panel card");
content.append(inspectCard, panel);

root.append(header, tagline, layout);

const scrollTopBtn = el("button", "scroll-top-btn");
scrollTopBtn.type = "button";
scrollTopBtn.setAttribute("aria-label", "Scroll to top");
scrollTopBtn.textContent = "↑";
scrollTopBtn.hidden = true;
scrollTopBtn.addEventListener("click", () => {
  window.scrollTo({ top: 0, behavior: "smooth" });
});
document.body.appendChild(scrollTopBtn);

const SCROLL_TOP_THRESHOLD = 120;
function updateScrollTopBtn(): void {
  scrollTopBtn.hidden = window.scrollY < SCROLL_TOP_THRESHOLD;
}
window.addEventListener("scroll", updateScrollTopBtn, { passive: true });
updateScrollTopBtn();

// --- wiring ----------------------------------------------------------------

form.addEventListener("submit", (e) => {
  e.preventDefault();
  const key = keyInput.value.trim();
  if (key) void inspect(key);
});

const combo = attachCombobox(keyInput, {
  getEntries: async () => {
    const listing = await getContractListing();
    return {
      entries: mergeComboEntries(listing.entries, listing.error),
      error: listing.error ? "Node contract list unavailable" : undefined,
    };
  },
  onPick: (keyId) => void inspect(keyId),
});

let pendingBootKey: string | null = readInspectedKey();
let connectedBefore = false;
const subscribeTimeouts = new Map<string, ReturnType<typeof setTimeout>>();

client.onStatus((s, detail) => {
  connStatus = s;
  connDetail = detail ?? "";
  renderStatus();
  if (s === "connected") {
    void startSummaryPrefetch();
    if (pendingBootKey) {
      const key = pendingBootKey;
      pendingBootKey = null;
      void inspect(key);
    }
    if (connectedBefore) {
      for (const insp of inspections.values()) {
        if (insp.subscribed) void beginSubscribe(insp);
      }
    }
    connectedBefore = true;
  }
});

client.onSubscribeResult((keyId, ok) => {
  clearSubscribeTimeout(keyId);
  const insp = inspections.get(keyId);
  if (!insp?.subscribePending) return;
  insp.subscribePending = false;
  if (ok) {
    insp.subscribed = true;
    insp.error = undefined;
  } else {
    insp.subscribed = false;
    insp.error = "node refused subscription";
  }
  if (keyId === currentKey) renderPanel();
});

client.onUpdate((update) => {
  const insp = inspections.get(update.keyId);
  if (!insp?.subscribed) return;
  insp.updates.push(update);
  if (insp.updates.length > MAX_UPDATES_KEPT) {
    insp.updates.splice(0, insp.updates.length - MAX_UPDATES_KEPT);
  }
  if (update.kind !== "delta") {
    insp.bytes = update.bytes;
    insp.sha = sha256Hex(update.bytes);
    insp.fetchedAt = update.receivedAt;
    insp.deep = deepDecode(update.bytes);
  }
  if (update.keyId === currentKey) renderPanel();
});

client.connect();
renderStatus();
renderSidebar();
renderPanel();

// --- actions ----------------------------------------------------------------

async function inspect(keyId: string): Promise<void> {
  currentKey = keyId;
  keyInput.value = keyId;
  let insp = inspections.get(keyId);
  if (!insp) {
    insp = {
      keyId,
      bytes: null,
      sha: "",
      fetchedAt: 0,
      subscribed: false,
      subscribePending: false,
      deep: null,
      updates: [],
    };
    inspections.set(keyId, insp);
  }
  insp.error = undefined;
  renderPanel();
  try {
    const bytes = await client.getState(keyId);
    insp.bytes = bytes;
    insp.sha = sha256Hex(bytes);
    insp.fetchedAt = Date.now();
    insp.deep = deepDecode(bytes);
    rememberSummary(keyId, insp.deep.value);
  } catch (e) {
    insp.error = e instanceof Error ? e.message : String(e);
  }
  renderPanel();
  renderSidebar();
  writeInspectedKey(keyId);
}

async function toggleWatch(insp: Inspection): Promise<void> {
  if (insp.subscribed || insp.subscribePending) {
    clearSubscribeTimeout(insp.keyId);
    insp.subscribed = false;
    insp.subscribePending = false;
    renderPanel();
    return;
  }
  await beginSubscribe(insp);
}

function clearSubscribeTimeout(keyId: string): void {
  const t = subscribeTimeouts.get(keyId);
  if (t !== undefined) {
    clearTimeout(t);
    subscribeTimeouts.delete(keyId);
  }
}

async function beginSubscribe(insp: Inspection): Promise<void> {
  insp.subscribePending = true;
  insp.subscribed = false;
  insp.error = undefined;
  renderPanel();
  clearSubscribeTimeout(insp.keyId);
  subscribeTimeouts.set(
    insp.keyId,
    setTimeout(() => {
      subscribeTimeouts.delete(insp.keyId);
      if (!insp.subscribePending) return;
      insp.subscribePending = false;
      insp.error = "subscription timed out waiting for node confirmation";
      if (insp.keyId === currentKey) renderPanel();
    }, SUBSCRIBE_TIMEOUT_MS),
  );
  try {
    const bytes = await client.subscribe(insp.keyId);
    insp.bytes = bytes;
    insp.sha = sha256Hex(bytes);
    insp.fetchedAt = Date.now();
    insp.deep = deepDecode(bytes);
    if (insp.keyId === currentKey) renderPanel();
  } catch (e) {
    clearSubscribeTimeout(insp.keyId);
    insp.subscribePending = false;
    insp.error = `watch failed: ${e instanceof Error ? e.message : String(e)}`;
    renderPanel();
  }
}

function togglePin(keyId: string): void {
  if (isPinned(keyId)) {
    watchlist = watchlist.filter((e) => e.keyId !== keyId);
  } else {
    const suggested = suggestWatchlistName(keyId);
    const entered = window.prompt("Name this pinned contract:", suggested);
    if (entered === null) return;
    const name = entered.trim() || suggested;
    watchlist = [...watchlist, { keyId, name }];
  }
  saveJson(WATCHLIST_KEY, watchlist);
  renderSidebar();
  renderPanel();
}

function isPinned(keyId: string): boolean {
  return watchlist.some((e) => e.keyId === keyId);
}

function loadWatchlist(): WatchlistEntry[] {
  const v2 = loadJson<WatchlistEntry[]>(WATCHLIST_KEY, []);
  if (v2.length > 0) return v2.filter((e) => e.keyId && e.name);
  const v1 = loadJson<string[]>(WATCHLIST_KEY_V1, []);
  return v1.map((keyId) => ({ keyId, name: shortKey(keyId) }));
}

function suggestWatchlistName(keyId: string): string {
  const insp = inspections.get(keyId);
  const root = insp?.deep?.value;
  if (root && typeof root === "object" && !Array.isArray(root)) {
    const name = (root as Record<string, unknown>).name;
    if (typeof name === "string" && name.trim()) return name.trim();
  }
  return shortKey(keyId);
}

async function getContractListing(): Promise<ContractListing> {
  const now = Date.now();
  if (contractCache && now - contractCache.at < CONTRACT_CACHE_TTL_MS) {
    return contractCache.listing;
  }
  const listing = await client.listContracts();
  contractCache = { at: now, listing };
  return listing;
}

function mergeComboEntries(entries: ContractEntry[], listingError?: string): KeyComboEntry[] {
  const seen = new Set<string>();
  const out: KeyComboEntry[] = [];
  const add = (keyId: string, badge?: KeyComboEntry["badge"]): void => {
    if (seen.has(keyId)) return;
    seen.add(keyId);
    out.push({ kind: "key", keyId, badge, summary: summaryCache[keyId] });
  };

  for (const e of entries) {
    if (e.badge === "subscribed") add(e.keyId, "subscribed");
  }
  for (const entry of watchlist) add(entry.keyId);
  for (const e of entries) {
    if (e.badge !== "subscribed") add(e.keyId);
  }
  if (listingError) {
    for (const keyId of inspections.keys()) add(keyId);
  }
  return out;
}

function rememberSummary(keyId: string, root: unknown): string {
  const summary = summaryFromDecoded(root);
  summaryCache[keyId] = summary;
  saveJson(SUMMARY_CACHE_KEY, summaryCache);
  combo.updateEntry(keyId, summary);
  return summary;
}

async function startSummaryPrefetch(): Promise<void> {
  if (summaryPrefetchRunning) return;
  summaryPrefetchRunning = true;
  try {
    const listing = await getContractListing();
    const keys = mergeComboEntries(listing.entries, listing.error).map((e) => e.keyId);
    const pending: string[] = [];

    for (const keyId of keys) {
      if (summaryCache[keyId]) {
        combo.updateEntry(keyId, summaryCache[keyId]);
        continue;
      }
      const insp = inspections.get(keyId);
      if (insp?.deep) {
        rememberSummary(keyId, insp.deep.value);
        continue;
      }
      pending.push(keyId);
    }

    const failed = await fetchSummariesSequentially(pending);
    await fetchSummariesSequentially(failed, true);
  } finally {
    summaryPrefetchRunning = false;
  }
}

async function fetchSummariesSequentially(keys: string[], finalPass = false): Promise<string[]> {
  const failed: string[] = [];
  for (const keyId of keys) {
    if (summaryCache[keyId]) {
      combo.updateEntry(keyId, summaryCache[keyId]);
      continue;
    }
    try {
      const bytes = await client.getState(keyId);
      rememberSummary(keyId, deepDecode(bytes).value);
    } catch {
      if (finalPass) {
        combo.updateEntry(keyId, "unknown");
      } else {
        failed.push(keyId);
      }
    }
  }
  return failed;
}

// --- rendering ---------------------------------------------------------------

function renderStatus(): void {
  statusPill.textContent = connStatus + (connDetail ? ` — ${connDetail}` : "");
  statusPill.className = `badge status-pill status-${connStatus}`;
}

function renderSidebar(): void {
  sidebar.replaceChildren();

  const watchHead = el("h2", undefined, "Watchlist");
  sidebar.appendChild(watchHead);
  if (!storageIsPersistent) {
    sidebar.appendChild(
      el("p", "muted small", "(storage unavailable in this sandbox — watchlist lives for this tab only)"),
    );
  }
  if (watchlist.length === 0) {
    sidebar.appendChild(el("p", "muted", "Nothing pinned yet. Inspect a contract and pin it."));
  } else {
    const list = el("ul", "watchlist");
    for (const entry of watchlist) {
      const item = el("li");
      const btn = el("button", "link-btn", entry.name);
      btn.title = entry.keyId;
      btn.addEventListener("click", () => void inspect(entry.keyId));
      const meta = inspections.get(entry.keyId);
      item.appendChild(btn);
      if (meta?.bytes) item.appendChild(el("span", "muted small", ` ${formatBytes(meta.bytes.length)}`));
      list.appendChild(item);
    }
    sidebar.appendChild(list);
  }

}

function renderPanel(): void {
  panel.replaceChildren();
  if (!currentKey) {
    panel.appendChild(
      el(
        "p",
        "muted empty-hint",
        "Enter a contract key above to fetch and decode its state from your node.",
      ),
    );
    return;
  }
  const insp = inspections.get(currentKey);
  if (!insp) return;

  if (insp.error) panel.appendChild(el("p", "error", insp.error));

  if (!insp.bytes) {
    if (!insp.error) panel.appendChild(el("p", "muted", "Fetching state…"));
    return;
  }

  const toolbar = el("div", "panel-toolbar");
  toolbar.appendChild(el("span", "state-size", formatBytes(insp.bytes.length)));
  toolbar.appendChild(createPinButton(insp.keyId, isPinned(insp.keyId)));
  panel.appendChild(toolbar);

  panel.appendChild(renderState(insp));

  const activity = el("div", "activity");
  const activityHead = el("div", "activity-head");
  activityHead.appendChild(el("h3", undefined, "Live updates"));
  const watchBtn = el(
    "button",
    insp.subscribed ? "subscribed" : undefined,
    insp.subscribePending ? "Subscribing…" : insp.subscribed ? "Watching" : "Watch",
  );
  watchBtn.addEventListener("click", () => void toggleWatch(insp));
  activityHead.appendChild(watchBtn);
  activity.appendChild(activityHead);

  if (insp.updates.length > 0) {
    const rows = insp.updates
      .slice(-20)
      .reverse()
      .map((u) => ({
        time: new Date(u.receivedAt).toLocaleTimeString(),
        kind: u.kind,
        size: formatBytes(u.bytes.length),
        sha256: `${sha256Hex(u.bytes).slice(0, 16)}…`,
      }));
    activity.appendChild(renderRowsTable(rows, ["time", "kind", "size", "sha256"]));
  }
  panel.appendChild(activity);
}

function renderState(insp: Inspection): HTMLElement {
  const box = el("div", "state-view");
  const deep = insp.deep!;

  box.appendChild(renderRoot(deep.value));

  return box;
}

function createPinButton(keyId: string, pinned: boolean): HTMLButtonElement {
  const btn = el("button", undefined, pinned ? "Unpin" : "Pin") as HTMLButtonElement;
  btn.type = "button";
  btn.addEventListener("click", () => togglePin(keyId));
  return btn;
}

function shortKey(keyId: string): string {
  return keyId.length > 20 ? `${keyId.slice(0, 10)}…${keyId.slice(-6)}` : keyId;
}
