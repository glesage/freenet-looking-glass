// Live-node tier: drives Looking Glass against a running Freenet node
// (default ws-api 127.0.0.1:7509). Requires a node — no skip path.
import { test, expect } from "@playwright/test";

const DEV_URL = process.env.UI_DEV_URL ?? "http://127.0.0.1:5173/";
const NODE_HOST = process.env.FREENET_NODE_HOST ?? "127.0.0.1:7509";

async function nodeIsReachable(): Promise<boolean> {
  try {
    const res = await fetch(`http://${NODE_HOST}/`, { signal: AbortSignal.timeout(2000) });
    return res.ok;
  } catch {
    return false;
  }
}

test.beforeAll(async () => {
  if (!(await nodeIsReachable())) {
    throw new Error(
      `No Freenet node at http://${NODE_HOST}/. Looking Glass reads state from a real ` +
        `node — start one (see freenet:local-dev) or set FREENET_NODE_HOST.`,
    );
  }
});

test("inspects a contract from the local node end to end", async ({ page }) => {
  test.setTimeout(30_000);

  const errors: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("dialog", (d) => d.accept("e2e-pin"));

  await page.goto(`${DEV_URL}?node=${NODE_HOST}`);

  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Looking Glass");
  await expect(page.locator(".status-pill")).toHaveText(/connected/);

  const keyInput = page.getByRole("combobox", { name: "Contract key" });
  await keyInput.focus();
  const listbox = page.getByRole("listbox");
  await expect(listbox).toBeVisible();
  await expect(listbox.locator(".combo-error")).toHaveCount(0);
  await expect(listbox.locator(".combo-summary").first()).toBeVisible();

  const options = listbox.getByRole("option");
  await expect(
    options.first(),
    "node hosts zero contracts — the e2e needs at least one hosted contract",
  ).toBeVisible({ timeout: 10_000 });

  await expect(async () => {
    const summaries = await listbox.locator(".combo-summary").allTextContents();
    expect(summaries.some((text) => text !== "…" && text.trim().length > 0)).toBe(true);
  }).toPass({ timeout: 60_000 });

  const summaryOptions = listbox.locator(".combo-option").filter({
    has: page.locator(".combo-summary:not(.combo-summary-loading)"),
  });
  const summaryText =
    (await summaryOptions.first().locator(".combo-summary").textContent())?.trim() ?? "";
  const summaryWord = summaryText.split(/\s+/).find((w) => w.length > 3) ?? "";
  if (summaryWord.length > 0) {
    await keyInput.fill(summaryWord);
    await expect(listbox.getByRole("option").filter({ hasText: summaryText }).first()).toBeVisible();
    await keyInput.fill("");
    await expect(listbox.getByRole("option").first()).toBeVisible();
  }

  const firstOption = options.first();
  const setSize = Number(await firstOption.getAttribute("aria-setsize"));
  const renderedCount = await options.count();
  if (setSize > renderedCount) {
    await listbox.evaluate((el) => {
      el.scrollTop = el.scrollHeight - el.clientHeight;
    });
    await expect(
      listbox.locator(`[role="option"][aria-posinset="${setSize}"]`),
    ).toBeVisible();
    await listbox.evaluate((el) => {
      el.scrollTop = 0;
    });
  }

  const firstKey = (await options.first().locator(".combo-key").textContent())?.trim() ?? "";
  expect(firstKey.length).toBeGreaterThan(8);

  const needle = firstKey.slice(-8);
  await keyInput.fill(needle);
  await expect(options.first()).toContainText(needle);

  await options.first().click();
  await expect(keyInput).toHaveValue(firstKey);
  await expect(page.locator(".empty-hint")).toHaveCount(0);

  await expect(page.locator(".state-size")).toContainText(/KiB|B/);
  const stateView = page.locator(".state-view");
  await expect(stateView).toBeVisible();
  await expect(stateView.locator(".tree-root, .val-bytes").first()).toBeVisible();

  await expect(page).toHaveURL(/[?&]focus=/);

  await page.getByRole("button", { name: "Pin" }).click();
  await expect(page.locator(".watchlist li")).toHaveCount(1);
  await page.getByRole("button", { name: "Unpin" }).click();
  await expect(page.locator(".watchlist li")).toHaveCount(0);

  await page.getByRole("button", { name: "Watch" }).click();
  await expect(page.getByRole("button", { name: "Watching" })).toBeVisible();
  await page.getByRole("button", { name: "Watching" }).click();
  await expect(page.getByRole("button", { name: "Watch" })).toBeVisible();

  expect(errors, `console errors:\n${errors.join("\n")}`).toEqual([]);
});

test("deep link restores the inspected contract on reload", async ({ page }) => {
  test.setTimeout(30_000);

  await page.goto(`${DEV_URL}?node=${NODE_HOST}`);

  const keyInput = page.getByRole("combobox", { name: "Contract key" });
  await keyInput.focus();
  const listbox = page.getByRole("listbox");
  await expect(listbox.getByRole("option").first()).toBeVisible({ timeout: 10_000 });
  const firstKey =
    (await listbox.getByRole("option").first().locator(".combo-key").textContent())?.trim() ?? "";
  expect(firstKey.length).toBeGreaterThan(0);

  await page.goto(`${DEV_URL}?node=${NODE_HOST}&focus=${firstKey}`);

  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Looking Glass");
  await expect(keyInput).toHaveValue(firstKey);
  await expect(page.locator(".empty-hint")).toHaveCount(0);
  await expect(page.locator(".state-view")).toBeVisible({ timeout: 10_000 });
});
