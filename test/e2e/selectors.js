export const S = {
	input: ".todo-input",
	addBtn: ".add-btn",
	priorityBtn: ".priority-btn",
	todoItem: ".todo-item",
	checkbox: (id) => `[data-action="toggle"][data-todo-id="${id}"]`,
	deleteBtn: (id) => `[data-action="delete"][data-todo-id="${id}"]`,
	filterAll: '[data-action="filter"][data-filter="0"]',
	filterActive: '[data-action="filter"][data-filter="1"]',
	filterCompleted: '[data-action="filter"][data-filter="2"]',
	clearBtn: '[data-action="clear-completed"]',
	badge: ".badge",
	highBadge: ".high-badge",
	// The reactive app's CSS scoping replaces the "sync-status" class with a
	// scoped name via bindAttr, so we also match by data-ref for that app.
	syncStatus: '.sync-status, [data-ref="syncStatus"]',
};
