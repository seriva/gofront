import { expect, test } from "@playwright/test";
import {
	addTodo,
	deleteTodo,
	gotoApp,
	seedStorage,
	toggleTodo,
	waitForSaved,
} from "./helpers.js";
import { S } from "./selectors.js";

test.beforeEach(async ({ page }) => {
	await seedStorage(page);
	await gotoApp(page);
});

// ── Section 1: Todo CRUD ──────────────────────────────────────────────────────

test("add todo → item appears in list", async ({ page }) => {
	await addTodo(page, "Feed the cat");
	await expect(
		page.locator(S.todoItem).filter({ hasText: "Feed the cat" }),
	).toBeVisible();
});

test("add todo with empty input → rejected", async ({ page }) => {
	const before = await page.locator(S.todoItem).count();
	await addTodo(page, "");
	await expect(page.locator(S.todoItem)).toHaveCount(before);
});

test("add todo exceeding max length → rejected", async ({ page }) => {
	const before = await page.locator(S.todoItem).count();
	const tooLong = "x".repeat(121);
	await addTodo(page, tooLong);
	await expect(page.locator(S.todoItem)).toHaveCount(before);
});

test("toggle todo → item gets done class", async ({ page }) => {
	await toggleTodo(page, 1);
	await expect(
		page.locator(S.todoItem).filter({ hasText: "Buy groceries" }),
	).toHaveClass(/done/);
});

test("toggle done todo → done class removed", async ({ page }) => {
	await toggleTodo(page, 3);
	await expect(
		page.locator(S.todoItem).filter({ hasText: "Write tests" }),
	).not.toHaveClass(/done/);
});

test("delete todo → item removed", async ({ page }) => {
	await deleteTodo(page, 2);
	await expect(
		page.locator(S.todoItem).filter({ hasText: "Read a book" }),
	).not.toBeVisible();
});

test("add multiple todos → all appear in list", async ({ page }) => {
	await addTodo(page, "Task Alpha");
	await addTodo(page, "Task Beta");
	await expect(
		page.locator(S.todoItem).filter({ hasText: "Task Alpha" }),
	).toBeVisible();
	await expect(
		page.locator(S.todoItem).filter({ hasText: "Task Beta" }),
	).toBeVisible();
});

// ── Section 2: Filtering ──────────────────────────────────────────────────────

test("filter Active → only incomplete todos visible", async ({ page }) => {
	await page.locator(S.filterActive).click();
	const items = page.locator(S.todoItem);
	// 2 active out of 3 initial todos
	await expect(items).toHaveCount(2);
	await expect(items.filter({ hasText: "Write tests" })).not.toBeVisible();
});

test("filter Completed → only done todos visible", async ({ page }) => {
	await page.locator(S.filterCompleted).click();
	const items = page.locator(S.todoItem);
	await expect(items).toHaveCount(1);
	await expect(items.filter({ hasText: "Write tests" })).toBeVisible();
});

test("filter All → all todos visible", async ({ page }) => {
	await page.locator(S.filterActive).click();
	await page.locator(S.filterAll).click();
	await expect(page.locator(S.todoItem)).toHaveCount(3);
});

test("active count updates after toggle", async ({ page }) => {
	await page.locator(S.filterActive).click();
	await expect(page.locator(S.todoItem)).toHaveCount(2);
	await toggleTodo(page, 1);
	await expect(page.locator(S.todoItem)).toHaveCount(1);
});

test("clear completed → removes done todos, active remain", async ({
	page,
}) => {
	await page.locator(S.clearBtn).click();
	await expect(
		page.locator(S.todoItem).filter({ hasText: "Write tests" }),
	).not.toBeVisible();
	await expect(
		page.locator(S.todoItem).filter({ hasText: "Buy groceries" }),
	).toBeVisible();
	await expect(
		page.locator(S.todoItem).filter({ hasText: "Read a book" }),
	).toBeVisible();
});

// ── Section 3: Priority mode ──────────────────────────────────────────────────

test("click priority button → button gets on class", async ({ page }) => {
	await page.locator(S.priorityBtn).click();
	await expect(page.locator(S.priorityBtn)).toHaveClass(/on/);
});

test("add todo in priority mode → item gets high class and badge", async ({
	page,
}) => {
	await page.locator(S.priorityBtn).click();
	await addTodo(page, "Urgent task");
	const item = page.locator(S.todoItem).filter({ hasText: "Urgent task" });
	await expect(item).toHaveClass(/high/);
	await expect(item.locator(S.badge)).toBeVisible();
});

test("click priority button again → mode off, subsequent todos are normal", async ({
	page,
}) => {
	await page.locator(S.priorityBtn).click();
	await page.locator(S.priorityBtn).click();
	await expect(page.locator(S.priorityBtn)).not.toHaveClass(/on/);
	await addTodo(page, "Normal task");
	await expect(
		page.locator(S.todoItem).filter({ hasText: "Normal task" }),
	).not.toHaveClass(/high/);
});

// ── Section 4: Persistence ────────────────────────────────────────────────────

test("add todos then reload → todos still present", async ({ page }) => {
	await addTodo(page, "Persist me");
	await waitForSaved(page);
	await page.reload();
	await page.locator(S.addBtn).waitFor({ state: "visible", timeout: 15000 });
	await expect(
		page.locator(S.todoItem).filter({ hasText: "Persist me" }),
	).toBeVisible();
});

test("toggle todo then reload → done state preserved", async ({ page }) => {
	await toggleTodo(page, 1);
	await waitForSaved(page);
	await page.reload();
	await page.locator(S.addBtn).waitFor({ state: "visible", timeout: 15000 });
	await expect(
		page.locator(S.todoItem).filter({ hasText: "Buy groceries" }),
	).toHaveClass(/done/);
});

test("clear completed then reload → cleared todos stay gone", async ({
	page,
}) => {
	await page.locator(S.clearBtn).click();
	await waitForSaved(page);
	await page.reload();
	await page.locator(S.addBtn).waitFor({ state: "visible", timeout: 15000 });
	await expect(
		page.locator(S.todoItem).filter({ hasText: "Write tests" }),
	).not.toBeVisible();
});

// ── Section 5: Drag-and-drop reordering ──────────────────────────────────────

test("drag first item below second → order swapped", async ({ page }) => {
	const items = page.locator(S.todoItem);
	const firstText = await items.nth(0).locator(".todo-text").textContent();
	const secondText = await items.nth(1).locator(".todo-text").textContent();

	// Drop near the bottom of the target to land after it
	await items.nth(0).dragTo(items.nth(1), { targetPosition: { x: 20, y: 40 } });

	await expect(items.nth(0).locator(".todo-text")).toHaveText(secondText);
	await expect(items.nth(1).locator(".todo-text")).toHaveText(firstText);
});

test("drag last item above first → item moves to top", async ({ page }) => {
	const items = page.locator(S.todoItem);
	const firstText = await items.nth(0).locator(".todo-text").textContent();
	const lastText = await items.nth(2).locator(".todo-text").textContent();

	// Drop near the top of the target to land before it
	await items.nth(2).dragTo(items.nth(0), { targetPosition: { x: 20, y: 5 } });

	await expect(items.nth(0).locator(".todo-text")).toHaveText(lastText);
	await expect(items.nth(1).locator(".todo-text")).toHaveText(firstText);
});

// ── Section 6: Sync status ────────────────────────────────────────────────────

test("after adding todo → sync status shows saved state", async ({ page }) => {
	await addTodo(page, "Trigger save");
	await expect(page.locator(S.syncStatus)).toContainText("Saved", {
		timeout: 5000,
	});
});

test("after toggling todo → sync status shows saved state", async ({
	page,
}) => {
	await toggleTodo(page, 1);
	await expect(page.locator(S.syncStatus)).toContainText("Saved", {
		timeout: 5000,
	});
});
