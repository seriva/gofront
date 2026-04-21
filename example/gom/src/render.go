package main

import "../gom"
import "./utils"

// ── Todo item ─────────────────────────────────────────────────

func todoItemNode(t Todo) gom.Node {
	cls := "todo-item"
	if t.done {
		cls = "todo-item done"
	} else if t.isUrgent() {
		cls = "todo-item high"
	}
	id := String(t.id)
	return gom.El("li",
		gom.Class(cls),
		gom.Attr("draggable", "true"),
		gom.DataAttr("id", id),
		gom.El("input",
			gom.Type("checkbox"),
			gom.Class("todo-cb"),
			gom.DataAttr("action", "toggle"),
			gom.DataAttr("todo-id", id),
			gom.If(t.done, gom.Attr("checked", "")),
		),
		gom.El("span", gom.Class("todo-text"), gom.Text(t.text)),
		gom.If(t.isUrgent(), gom.El("span", gom.Class("badge"), gom.Text("urgent"))),
		gom.El("button",
			gom.Class("del-btn"),
			gom.DataAttr("action", "delete"),
			gom.DataAttr("todo-id", id),
			gom.Text("✕"),
		),
	)
}

// ── Todo list ─────────────────────────────────────────────────

func todoListNode() gom.Node {
	visible := visibleTodos()
	if len(visible) == 0 {
		return gom.El("ul", gom.Class("todo-list"),
			gom.El("li", gom.Class("empty"), gom.Text("Nothing here.")),
		)
	}
	return gom.El("ul", gom.Class("todo-list"), gom.Map(visible, todoItemNode))
}

// ── Filter bar ────────────────────────────────────────────────

func filterBarNode() gom.Node {
	fs := []int{FilterAll, FilterActive, FilterCompleted}
	return gom.El("div", gom.Class("filter-bar"), gom.Map(fs, func(f int) gom.Node {
		cls := "filter-btn"
		if f == filter {
			cls = "filter-btn active"
		}
		return gom.El("button",
			gom.Class(cls),
			gom.DataAttr("action", "filter"),
			gom.DataAttr("filter", String(f)),
			gom.Text(filterLabel(f)),
		)
	}))
}

// ── Footer ────────────────────────────────────────────────────

func footerNode() gom.Node {
	if len(todos) == 0 {
		return gom.El("footer", gom.Class("footer"))
	}
	remaining, completed := stats()
	countText := utils.Plural(remaining, "task") + " left"
	return gom.El("footer", gom.Class("footer"),
		gom.El("span", gom.Class("count"), gom.Text(countText)),
		filterBarNode(),
		gom.If(completed > 0, gom.El("button",
			gom.Class("clear-btn"),
			gom.DataAttr("action", "clear-completed"),
			gom.Text("Clear ("+String(completed)+")"),
		)),
	)
}

// ── Header ────────────────────────────────────────────────────

func badgeNode() gom.Node {
	hc := highCount()
	if hc > 0 {
		return gom.El("span", gom.Class("high-badge"), gom.Text(String(hc)+" urgent"))
	}
	return gom.El("span", gom.Class("high-badge"), gom.Attr("style", "display:none"))
}

func syncStatusNode() gom.Node {
	cls := "sync-status"
	if syncCls != "" {
		cls = "sync-status " + syncCls
	}
	return gom.El("span", gom.Class(cls), gom.Text(syncMsg))
}

func headerNode() gom.Node {
	return gom.El("header", gom.Class("header"),
		gom.El("div", gom.Class("header-top"),
			gom.El("div", gom.Class("header-icon"), gom.Text("✓")),
			gom.El("h1", gom.Text("Todos Gom")),
			badgeNode(),
			syncStatusNode(),
		),
		gom.El("p", gom.Class("tagline"),
			gom.Text("Built with "),
			gom.El("a",
				gom.Href("https://github.com/seriva/gofront"),
				gom.Attr("target", "_blank"),
				gom.El("strong", gom.Text("GoFront")),
			),
			gom.Text(" — Go compiled to JS"),
		),
	)
}

// ── Input row ─────────────────────────────────────────────────

func inputRowNode() gom.Node {
	priorityCls := "priority-btn"
	priorityText := "⚡ Normal"
	if highPriority {
		priorityCls = "priority-btn on"
		priorityText = "⚡ High"
	}
	inputCls := "todo-input"
	if highPriority {
		inputCls = "todo-input high"
	}
	placeholder := "What needs to be done?"
	if highPriority {
		placeholder = "What's urgent? (high priority)"
	}
	return gom.El("div", gom.Class("input-row"),
		gom.El("input",
			gom.Class(inputCls),
			gom.Type("text"),
			gom.Placeholder(placeholder),
			gom.Attr("autocomplete", "off"),
		),
		gom.El("button", gom.Class(priorityCls), gom.Type("button"),
			gom.DataAttr("action", "priority"),
			gom.Text(priorityText),
		),
		gom.El("button", gom.Class("add-btn"), gom.Type("button"),
			gom.DataAttr("action", "add"),
			gom.Text("Add"),
		),
		gom.If(highPriority, gom.El("span", gom.Class("priority-hint"),
			gom.Text("⚡ High priority — task will be marked urgent"),
		)),
		gom.If(errorMsg != "", gom.El("span", gom.Class("error-msg"),
			gom.Text(errorMsg),
		)),
	)
}

// ── Stats bar ─────────────────────────────────────────────────

func statsBarNode() gom.Node {
	n := len(todos)
	word := "todos"
	if n == 1 {
		word = "todo"
	}
	return gom.El("div", gom.Class("stats-bar"),
		gom.El("span", gom.DataAttr("action", "filter-active"),
			gom.El("strong", gom.Text(String(n))),
			gom.Text(" "+word+" in session"),
		),
	)
}

// ── App root ──────────────────────────────────────────────────

func appView() gom.Node {
	return gom.El("div", gom.Class("card"),
		headerNode(),
		inputRowNode(),
		gom.El("div", gom.Class("list-divider")),
		todoListNode(),
		footerNode(),
		statsBarNode(),
	)
}

// ── Render ────────────────────────────────────────────────────

// render replaces the contents of #app with the current view.
// All event listeners are attached to #app itself (which persists across renders)
// so no re-attachment is needed here.
func render() {
	gom.Mount("#app", appView())
}
