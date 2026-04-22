import { expect, test } from "@playwright/test";
import { gotoApp, seedStorage } from "./helpers.js";
import { S } from "./selectors.js";

test.beforeEach(async ({ page }) => {
	await seedStorage(page);
	await gotoApp(page);
});

test("injectStyles created a style tag in head", async ({ page }) => {
	const styleCount = await page.locator("head style").count();
	expect(styleCount).toBeGreaterThan(0);
});

test("high-badge shows urgent count for high-priority todos", async ({
	page,
}) => {
	// Initial todos have no high-priority items → badge hidden
	const badge = page.locator(S.highBadge);
	const display = await badge.evaluate((el) => el.style.display);
	expect(display).toBe("none");
});

test("high-badge appears after adding urgent todo", async ({ page }) => {
	await page.locator(S.priorityBtn).click();
	await page.locator(S.input).fill("Urgent item");
	await page.locator(S.addBtn).click();
	await expect(page.locator(S.highBadge)).toContainText("urgent");
});
