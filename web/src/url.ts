// Deep-link URL sync for inspected contract keys. Uses query params (not path
// segments) so links survive the Freenet gateway and static dev servers — same
// pattern as River's ?room= deep links.

const FOCUS_PARAM = "focus";

function queryPairs(search: string): Array<[string, string]> {
  return search
    .trimStart()
    .replace(/^\?/, "")
    .split("&")
    .filter((part) => part.length > 0)
    .map((part) => {
      const eq = part.indexOf("=");
      if (eq === -1) return [part, ""] as const;
      return [part.slice(0, eq), part.slice(eq + 1)] as const;
    });
}

export function formatKeyQuery(search: string, keyId: string | null): string {
  const parts = queryPairs(search)
    .filter(([key]) => key !== FOCUS_PARAM)
    .map(([key, value]) => (value === "" ? key : `${key}=${value}`));
  if (keyId) parts.push(`${FOCUS_PARAM}=${keyId}`);
  return parts.length === 0 ? "" : `?${parts.join("&")}`;
}

export function keyFromHashFragment(hash: string): string | null {
  if (!hash || hash === "#") return null;
  const h = hash.startsWith("#") ? hash.slice(1) : hash;
  if (!h || h.includes("/") || h.includes("=")) return null;
  return h;
}

export function readInspectedKeyFrom(search: string, hash: string): string | null {
  for (const [key, value] of queryPairs(search)) {
    if (key === FOCUS_PARAM && value.trim()) return value.trim();
  }
  return keyFromHashFragment(hash);
}

export function readInspectedKey(): string | null {
  return readInspectedKeyFrom(location.search, location.hash);
}

export function writeInspectedKey(keyId: string): void {
  const search = formatKeyQuery(location.search, keyId);
  const hash = `#${keyId}`;
  const newUrl = `${location.pathname}${search}${hash}`;
  history.replaceState(null, "", newUrl);
  if (window.parent !== window) {
    window.parent.postMessage({ __freenet_shell__: true, type: "hash", hash }, "*");
  }
}
