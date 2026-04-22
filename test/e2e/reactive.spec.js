import { expect, test } from "@playwright/test";
import { gotoApp, seedStorage } from "./helpers.js";
import { S } from "./selectors.js";

test.beforeEach(async ({ page }) => {
	await seedStorage(page);
	await gotoApp(page);
});

test("stats bar mounts into #stats-bar", async ({ page }) => {
	const statsBar = page.locator("#stats-bar");
	await expect(statsBar).not.toBeEmpty();
});

test("loading placeholder visible before todos load", async ({ page }) => {
	// Re-navigate — the reactive app always shows a 200ms loading placeholder
	// because asyncLoadFromStorage has an intentional delay. page.goto returns
	// when the load event fires (right after main() sets up the placeholder),
	// while the 200ms computedAsync delay is still counting down.
	await page.goto("/");
	await expect(page.getByText("Loading todos")).toBeVisible({ timeout: 3000 });
	await page.locator(S.addBtn).waitFor({ state: "visible", timeout: 10000 });
});

test("rapid toggles settle to correct state", async ({ page }) => {
	const checkbox = page.locator(S.checkbox(1));
	await checkbox.click();
	await checkbox.click();
	await checkbox.click();
	// Odd number of clicks: should end up toggled
	await expect(
		page.locator(S.todoItem).filter({ hasText: "Buy groceries" }),
	).toHaveClass(/done/);
});

test("high-badge shows urgent count", async ({ page }) => {
	const badge = page.locator(S.highBadge);
	// Initial state: no urgent todos → badge invisible or empty
	const display = await badge.evaluate((el) => el.style.display);
	expect(["none", ""]).toContain(display);
});

test("sync status shows saving then saved cycle", async ({ page }) => {
	// The reactive saveTodos has a 350ms sleep, making the intermediate
	// "Saving…" state reliably visible — unlike simple/gom which save instantly.
	const sync = page.locator(S.syncStatus);
	await page.locator(S.input).fill("Saving cycle test");
	await page.locator(S.addBtn).click();
	await expect(sync).toContainText("Saving", { timeout: 3000 });
	await expect(sync).toContainText("Saved", { timeout: 3000 });
});
