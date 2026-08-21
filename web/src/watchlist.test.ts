import { describe, expect, it, vi } from "vitest";
import * as storage from "./storage";
import {
  addPin,
  importLegacyWatchlist,
  isPinned,
  parseWatchlist,
  removePin,
  serializeWatchlist,
} from "./watchlist";

describe("watchlist", () => {
  it("adds and removes pins", () => {
    let list = addPin([], { keyId: "abc", name: "A" });
    expect(isPinned(list, "abc")).toBe(true);
    list = removePin(list, "abc");
    expect(isPinned(list, "abc")).toBe(false);
  });

  it("parseWatchlist returns empty on garbage", () => {
    expect(parseWatchlist(new TextEncoder().encode("not json"))).toEqual([]);
  });

  it("parseWatchlist returns empty on null JSON", () => {
    expect(parseWatchlist(new TextEncoder().encode("null"))).toEqual([]);
  });

  it("parseWatchlist drops entries missing name", () => {
    const bytes = new TextEncoder().encode(JSON.stringify([{ keyId: "abc" }]));
    expect(parseWatchlist(bytes)).toEqual([]);
  });

  it("round-trips through serializeWatchlist", () => {
    const list = [{ keyId: "k1", name: "One" }];
    expect(parseWatchlist(serializeWatchlist(list))).toEqual(list);
  });

  it("importLegacyWatchlist promotes v1 keys", () => {
    const longKey = "oldKey123456789012345678901234567890";
    vi.spyOn(storage, "loadJson").mockImplementation((key, fallback) => {
      if (key === "looking-glass.watchlist.v2") return [];
      if (key === "looking-glass.watchlist.v1") return [longKey];
      return fallback;
    });
    const legacy = importLegacyWatchlist();
    expect(legacy).toEqual([{ keyId: longKey, name: "oldKey1234…567890" }]);
    vi.restoreAllMocks();
  });
});
