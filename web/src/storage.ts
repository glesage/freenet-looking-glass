// Watchlist persistence. The gateway sandbox iframe has an opaque origin, so
// merely TOUCHING window.localStorage can throw a SecurityError (same failure
// class as freenet-core#4945, where a property read killed the shell bridge).
// Every access is wrapped; fallback is in-memory for the tab's lifetime.

const memory = new Map<string, string>();

function tryStorage(): Storage | null {
  try {
    const s = window.localStorage;
    const probe = "__looking_glass_probe__";
    s.setItem(probe, "1");
    s.removeItem(probe);
    return s;
  } catch {
    return null;
  }
}

const backing = tryStorage();

export function loadJson<T>(key: string, fallback: T): T {
  try {
    const raw = backing ? backing.getItem(key) : memory.get(key) ?? null;
    if (raw === null || raw === undefined) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function saveJson(key: string, value: unknown): void {
  try {
    const raw = JSON.stringify(value);
    if (backing) backing.setItem(key, raw);
    else memory.set(key, raw);
  } catch {
    // quota / serialization failure — watchlist is cosmetic, drop silently
  }
}

export const storageIsPersistent = backing !== null;
