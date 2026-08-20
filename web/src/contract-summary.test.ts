import { describe, expect, it } from "vitest";
import { summaryFromDecoded } from "./contract-summary";

describe("summaryFromDecoded", () => {
  it("uses note from web container state", () => {
    const summary = summaryFromDecoded({
      note:
        "This contract holds a website bundle (the app's UI), not its data. " +
        "App data lives in separate contracts.",
    });
    expect(summary).toContain("website bundle");
    expect(summary).toContain("App data lives in separate contracts");
  });

  it("uses config.config name and description", () => {
    const summary = summaryFromDecoded({
      config: {
        config: {
          name: "My App",
          description: "Does things",
        },
      },
    });
    expect(summary).toBe("My App - Does things");
  });

  it("uses River public display metadata", () => {
    const summary = summaryFromDecoded({
      configuration: {
        configuration: {
          display: {
            name: { Public: { value: new TextEncoder().encode("Town Square") } },
            description: { Public: { value: new TextEncoder().encode("General chat") } },
          },
        },
      },
    });
    expect(summary).toBe("Town Square - General chat");
  });

  it("falls back to unknown when private display metadata has no Public branch", () => {
    const summary = summaryFromDecoded({
      configuration: {
        configuration: {
          display: {
            name: { Private: { ciphertext: [1, 2, 3], nonce: new Array(12).fill(0), secret_version: 1, declared_len_bytes: 3 } },
          },
        },
      },
    });
    expect(summary).toBe("unknown");
  });

  it("returns unknown for empty objects", () => {
    expect(summaryFromDecoded({})).toBe("unknown");
  });
});
