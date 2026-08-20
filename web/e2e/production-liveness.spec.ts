// Liveness tier: runs against the gateway-hosted URL after `fdev website
// publish`. Catches CSP blocks, iframe-shell regressions, and broken archives
// that no offline test reaches. Skipped unless FREENET_BASE_URL is a
// /v1/contract/web/... URL, so it is harmless in offline CI.
import { test, expect, type ConsoleMessage } from "@playwright/test";

const BASE_URL = process.env.FREENET_BASE_URL;
const SKIP = !BASE_URL || !/\/v1\/contract\/web\//.test(BASE_URL);

const FATAL_CONSOLE_PATTERNS = [
  /Content Security Policy/i,
  /Refused to (load|apply|execute|connect)/i,
  /Failed to load resource/i,
  /net::ERR_/i,
];

test.describe("production liveness", () => {
  test.skip(SKIP, "FREENET_BASE_URL not set to a /v1/contract/web/... path");

  test("webapp mounts in the gateway shell, CSS loads, no fatal errors", async ({ page }) => {
    const fatalErrors: string[] = [];
    page.on("console", (msg: ConsoleMessage) => {
      if (msg.type() !== "error") return;
      const text = msg.text();
      if (FATAL_CONSOLE_PATTERNS.some((re) => re.test(text))) fatalErrors.push(text);
    });
    page.on("pageerror", (err) => {
      const text = String(err);
      // Benign wasm-bindgen/shell-bridge noise class — see dapp-builder skill.
      if (/not marked as 'catch'.*expected a string argument, found undefined/.test(text)) return;
      fatalErrors.push(text);
    });
    page.on("requestfailed", (req) =>
      fatalErrors.push(`requestfailed: ${req.url()} (${req.failure()?.errorText})`),
    );

    // Absolute URL: page.goto("/") would drop the contract path and land on
    // the node dashboard.
    await page.goto(BASE_URL!);

    // 1. Shell bridge ran and wired the sandboxed iframe.
    await expect(page.locator("iframe#app")).toHaveAttribute("src", /__sandbox=1/, {
      timeout: 10_000,
    });

    // 2. The app mounted inside the iframe.
    const app = page.frameLocator("iframe#app");
    await expect(app.getByRole("heading", { level: 1 })).toHaveText("Looking Glass", {
      timeout: 15_000,
    });

    const fontSize = await app
      .getByRole("heading", { level: 1 })
      .evaluate((el) => getComputedStyle(el).fontSize);
    expect(fontSize, "bundled CSS did not load — check CSP / relative base").toBe("17.6px");

    // 4. No fatal console/network errors during load.
    expect(fatalErrors, `fatal errors:\n${fatalErrors.join("\n")}`).toEqual([]);
  });
});
