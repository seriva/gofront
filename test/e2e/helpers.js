import { expect } from "@playwright/test";
import { S } from "./selectors.js";

export const INITIAL_TODOS = [
	{ id: 1, text: "Buy groceries", done: false, priority: 0 },
	{ id: 2, text: "Read a book", done: false, priority: 0 },
	{ id: 3, text: "Write tests", done: true, priority: 0 },
];

/**
 * Set up initial localStorage state once per browser context (not on reloads).
 * Uses sessionStorage as a per-context flag so reloads within a test preserve
 * any state saved by the app, enabling persistence tests.
 */
export async function seedStorage(page) {
	await page.addInitScript((todos) => {
		if (!sessionStorage.getItem("__e2e_init")) {
			sessionStorage.setItem("__e2e_init", "1");
			localStorage.setItem("todos", JSON.stringify(todos));
		}
	}, INITIAL_TODOS);
}

/** Navigate and wait until the app is fully rendered. */
export async function gotoApp(page) {
	await page.goto("/");
	await page.locator(S.addBtn).waitFor({ state: "visible", timeout: 15000 });
}

/** Type text into the input and click Add. */
export async function addTodo(page, text) {
	await page.locator(S.input).fill(text);
	await page.locator(S.addBtn).click();
}

/** Click the checkbox for a specific todo id. */
export async function toggleTodo(page, id) {
	await page.locator(S.checkbox(id)).click();
}

/** Click the delete button for a specific todo id. */
export async function deleteTodo(page, id) {
	await page.locator(S.deleteBtn(id)).click();
}

/** Wait for sync status to show "Saved". */
export async function waitForSaved(page) {
	await expect(page.locator(S.syncStatus)).toContainText("Saved", {
		timeout: 5000,
	});
}

/** Get all data-todo-id values visible in the todo list. */
export async function getTodoIds(page) {
	return page
		.locator(`${S.todoItem} [data-action="toggle"]`)
		.evaluateAll((els) =>
			els.map((el) => Number(el.getAttribute("data-todo-id"))),
		);
}
