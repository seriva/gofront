package main

import "./utils"

// ── Class / text helpers used by render.templ ─────────────────

func todoItemClass(t Todo) string {
	if t.done {
		return "todo-item done"
	}
	if t.isUrgent() {
		return "todo-item high"
	}
	return "todo-item"
}

func filterBtnClass(f int, active int) string {
	if f == active {
		return "filter-btn active"
	}
	return "filter-btn"
}

func syncStatusClass(cls string) string {
	if cls != "" {
		return "sync-status " + cls
	}
	return "sync-status"
}

func inputClass(hi bool) string {
	if hi {
		return "todo-input high"
	}
	return "todo-input"
}

func inputPlaceholder(hi bool) string {
	if hi {
		return "What's urgent? (high priority)"
	}
	return "What needs to be done?"
}

func priorityBtnClass(hi bool) string {
	if hi {
		return "priority-btn on"
	}
	return "priority-btn"
}

func priorityBtnText(hi bool) string {
	if hi {
		return "⚡ High"
	}
	return "⚡ Normal"
}

func todosWord(n int) string {
	if n == 1 {
		return "todo"
	}
	return "todos"
}

func footerCountText() string {
	remaining, _ := stats()
	return utils.Plural(remaining, "task") + " left"
}

func completedCount() int {
	_, completed := stats()
	return completed
}

// ── Render ────────────────────────────────────────────────────

func render() {
	gom.Mount("#app", AppView())
}
