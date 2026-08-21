import { loadJson } from "./storage";

export interface WatchlistEntry {
  keyId: string;
  name: string;
}

const WATCHLIST_KEY = "looking-glass.watchlist.v2";
const WATCHLIST_KEY_V1 = "looking-glass.watchlist.v1";

export function shortKey(keyId: string): string {
  return keyId.length > 20 ? `${keyId.slice(0, 10)}…${keyId.slice(-6)}` : keyId;
}

export function isPinned(list: WatchlistEntry[], keyId: string): boolean {
  return list.some((e) => e.keyId === keyId);
}

export function addPin(list: WatchlistEntry[], entry: WatchlistEntry): WatchlistEntry[] {
  if (isPinned(list, entry.keyId)) return list;
  return [...list, entry];
}

export function removePin(list: WatchlistEntry[], keyId: string): WatchlistEntry[] {
  return list.filter((e) => e.keyId !== keyId);
}

export function serializeWatchlist(list: WatchlistEntry[]): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(list));
}

export function parseWatchlist(bytes: Uint8Array): WatchlistEntry[] {
  try {
    const raw = JSON.parse(new TextDecoder().decode(bytes)) as unknown;
    if (!Array.isArray(raw)) return [];
    const seen = new Set<string>();
    return raw.filter(
      (e): e is WatchlistEntry => {
        if (
          !e ||
          typeof e !== "object" ||
          typeof (e as WatchlistEntry).keyId !== "string" ||
          typeof (e as WatchlistEntry).name !== "string"
        ) {
          return false;
        }
        const { keyId } = e as WatchlistEntry;
        if (seen.has(keyId)) return false;
        seen.add(keyId);
        return true;
      },
    );
  } catch {
    return [];
  }
}

export function importLegacyWatchlist(): WatchlistEntry[] {
  const v2 = loadJson<WatchlistEntry[]>(WATCHLIST_KEY, []);
  if (v2.length > 0) return v2.filter((e) => e.keyId && e.name);
  const v1 = loadJson<string[]>(WATCHLIST_KEY_V1, []);
  return v1.map((keyId) => ({ keyId, name: shortKey(keyId) }));
}
