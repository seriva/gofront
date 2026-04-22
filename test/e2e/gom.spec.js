import { expect, test } from "@playwright/test";
import { gotoApp, seedStorage } from "./helpers.js";
import { S } from "./selectors.js";

test.beforeEach(async ({ page }) => {
	await seedStorage(page);
	await gotoApp(page);
});

test("gom.Style injected a style tag into head", async ({ page }) => {
	const styleCount = await page.locator("head style").count();
	expect(styleCount).toBeGreaterThan(0);
});

test("high-badge absent when no urgent todos", async ({ page }) => {
	// gom uses gom.If — element is not rendered at all when no urgent todos
	const badge = page.locator(S.highBadge);
	await expect(badge).not.toBeVisible();
});

test("high-badge appears after adding urgent todo", async ({ page }) => {
	await page.locator(S.priorityBtn).click();
	await page.locator(S.input).fill("Critical fix");
	await page.locator(S.addBtn).click();
	await expect(page.locator(S.highBadge)).toContainText("urgent");
});

test("stats-bar renders as .stats-bar", async ({ page }) => {
	await expect(page.locator(".stats-bar")).toBeVisible();
});
