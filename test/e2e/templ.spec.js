import { expect, test } from "@playwright/test";
import { gotoApp, seedStorage } from "./helpers.js";
import { S } from "./selectors.js";

test.beforeEach(async ({ page }) => {
	await seedStorage(page);
	await gotoApp(page);
});

test("templ components render the app shell", async ({ page }) => {
	await expect(page.locator("h1")).toContainText("Todos Templ");
	await expect(page.locator(".card")).toBeVisible();
	await expect(page.locator(".header")).toBeVisible();
	await expect(page.locator(".input-row")).toBeVisible();
	await expect(page.locator(".todo-list")).toBeVisible();
	await expect(page.locator(".footer")).toBeVisible();
	await expect(page.locator(".stats-bar")).toBeVisible();
});

test("@templ.Raw injected a style tag into head", async ({ page }) => {
	const styleCount = await page.locator("head style").count();
	expect(styleCount).toBeGreaterThan(0);
});

test("high-badge absent when no urgent todos", async ({ page }) => {
	await expect(page.locator(S.highBadge)).not.toBeVisible();
});

test("high-badge appears after adding urgent todo", async ({ page }) => {
	await page.locator(S.priorityBtn).click();
	await page.locator(S.input).fill("Critical fix");
	await page.locator(S.addBtn).click();
	await expect(page.locator(S.highBadge)).toContainText("urgent");
});

test("stats-bar shows correct todo count", async ({ page }) => {
	await expect(page.locator(".stats-bar")).toContainText("3");
});

test("templ if/else: priority hint shown only in high-priority mode", async ({
	page,
}) => {
	await expect(page.locator(".priority-hint")).not.toBeVisible();
	await page.locator(S.priorityBtn).click();
	await expect(page.locator(".priority-hint")).toBeVisible();
	await page.locator(S.priorityBtn).click();
	await expect(page.locator(".priority-hint")).not.toBeVisible();
});

test("templ for loop: all seeded todos rendered as list items", async ({
	page,
}) => {
	const items = page.locator(S.todoItem);
	await expect(items).toHaveCount(3);
	await expect(items.filter({ hasText: "Buy groceries" })).toBeVisible();
	await expect(items.filter({ hasText: "Read a book" })).toBeVisible();
	await expect(items.filter({ hasText: "Write tests" })).toBeVisible();
});

test("templ conditional bool attr: checked item renders checkbox as checked", async ({
	page,
}) => {
	// "Write tests" is seeded as done=true
	const cb = page.locator('[data-action="toggle"][data-todo-id="3"]');
	await expect(cb).toBeChecked();
});

test("templ switch: filter buttons render correct labels via switch case", async ({
	page,
}) => {
	// FilterButton uses `switch f { case FilterAll: ... case FilterActive: ... case FilterCompleted: ... }`
	await expect(page.locator(S.filterAll)).toContainText("All");
	await expect(page.locator(S.filterActive)).toContainText("Active");
	await expect(page.locator(S.filterCompleted)).toContainText("Completed");
});

test("templ switch: active filter button gets active class", async ({
	page,
}) => {
	// Initially filter=All; clicking Active should give it the active class
	await expect(page.locator(S.filterAll)).toHaveClass(/active/);
	await page.locator(S.filterActive).click();
	await expect(page.locator(S.filterActive)).toHaveClass(/active/);
	await expect(page.locator(S.filterAll)).not.toHaveClass(/active/);
});
