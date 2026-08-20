import { DecodedBytes } from "./decoders";

const MAX_SUMMARY_LEN = 120;

export function summaryFromDecoded(root: unknown): string {
  const note = asDisplayString(valueAt(root, ["note"]));
  if (note) return truncate(note);

  const configName = asDisplayString(valueAt(root, ["config", "config", "name"]));
  const configDesc = asDisplayString(valueAt(root, ["config", "config", "description"]));
  if (configName) return truncate(joinParts(configName, configDesc));

  const roomName = asDisplayString(
    valueAt(root, ["configuration", "configuration", "display", "name", "Public", "value"]),
  );
  const roomDesc = asDisplayString(
    valueAt(root, ["configuration", "configuration", "display", "description", "Public", "value"]),
  );
  if (roomName) return truncate(joinParts(roomName, roomDesc));

  return "unknown";
}

export function valueAt(root: unknown, path: string[]): unknown {
  let cur: unknown = root;
  for (const key of path) {
    cur = unwrap(cur);
    if (cur === null || typeof cur !== "object" || Array.isArray(cur)) return undefined;
    cur = (cur as Record<string, unknown>)[key];
  }
  return unwrap(cur);
}

function unwrap(value: unknown): unknown {
  if (value instanceof DecodedBytes) return value.value;
  return value;
}

export function asDisplayString(value: unknown): string | null {
  const v = unwrap(value);
  if (typeof v === "string") {
    const trimmed = v.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  if (v instanceof Uint8Array) {
    try {
      const trimmed = new TextDecoder().decode(v).trim();
      return trimmed.length > 0 ? trimmed : null;
    } catch {
      return null;
    }
  }
  if (Array.isArray(v) && v.every((b) => typeof b === "number" && b >= 0 && b <= 255)) {
    return asDisplayString(Uint8Array.from(v as number[]));
  }
  return null;
}

function joinParts(name: string, description: string | null): string {
  if (description) return `${name} - ${description}`;
  return name;
}

function truncate(text: string): string {
  if (text.length <= MAX_SUMMARY_LEN) return text;
  return `${text.slice(0, MAX_SUMMARY_LEN - 1)}…`;
}
