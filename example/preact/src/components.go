package main

import "./utils"
import "js:./preact.d.ts"

func itemClass(t Todo, editing any) string {
	cls := "todo-item"
	if t.Done {
		cls += " done"
	} else if t.isUrgent() {
		cls += " high"
	}
	if editing == true {
		cls += " editing"
	}
	return cls
}

func TodoItem(p TodoItemProps) VNode {
	editing, setEditing := useState(false)
	editText, setEditText := useState(p.Todo.Text)

	itemCls := itemClass(p.Todo, editing)
	idStr := String(p.Todo.ID)

	var badgeChild any
	if p.Todo.isUrgent() {
		badgeChild = h("span", map[string]any{"class": "badge"}, "urgent")
	}

	var textChild VNode
	if editing == true {
		textChild = h("input", map[string]any{
			"type":      "text",
			"class":     "edit-input",
			"value":     editText,
			"autoFocus": true,
			"onInput": func(e any) {
				setEditText(e.target.value)
			},
			"onKeyDown": func(e any) {
				if e.key == "Enter" {
					if p.OnEdit != nil {
						p.OnEdit(p.Todo.ID, String(editText))
					}
					setEditing(false)
				} else if e.key == "Escape" {
					setEditText(p.Todo.Text)
					setEditing(false)
				}
			},
			"onBlur": func(e any) {
				if p.OnEdit != nil {
					p.OnEdit(p.Todo.ID, String(editText))
				}
				setEditing(false)
			},
		})
	} else {
		textChild = h("span", map[string]any{
			"class": "todo-text",
			"onDblClick": func(e any) {
				setEditText(p.Todo.Text)
				setEditing(true)
			},
		}, p.Todo.Text)
	}

	return h("li", map[string]any{
		"class":       itemCls,
		"draggable":   "true",
		"data-id":     idStr,
		"onDragStart": p.OnDragStart,
		"onDragOver":  p.OnDragOver,
		"onDrop":      p.OnDrop,
		"onDragEnd":   p.OnDragEnd,
	},
		h("input", map[string]any{
			"type":         "checkbox",
			"class":        "todo-cb",
			"data-action":  "toggle",
			"data-todo-id": idStr,
			"checked":      p.Todo.Done,
			"onChange": func(e any) {
				if p.OnToggle != nil {
					p.OnToggle(p.Todo.ID)
				}
			},
		}),
		textChild,
		badgeChild,
		h("button", map[string]any{
			"type":         "button",
			"class":        "del-btn",
			"data-action":  "delete",
			"data-todo-id": idStr,
			"onClick": func(e any) {
				if p.OnDelete != nil {
					p.OnDelete(p.Todo.ID)
				}
			},
		}, "✕"),
	)
}

func Header(p HeaderProps) VNode {
	var badgeStyle string
	var badgeText string
	if p.UrgentCount > 0 {
		badgeStyle = "display: inline-block"
		badgeText = String(p.UrgentCount) + " urgent"
	} else {
		badgeStyle = "display: none"
	}

	syncClass := "sync-status"
	if p.SyncCls != "" {
		syncClass = "sync-status " + p.SyncCls
	}

	return h("header", map[string]any{"class": "header"},
		h("div", map[string]any{"class": "header-top"},
			h("div", map[string]any{"class": "header-icon"}, "✓"),
			h("h1", nil, "Todos Preact"),
			h("span", map[string]any{
				"class": "high-badge",
				"style": badgeStyle,
			}, badgeText),
			h("span", map[string]any{
				"class":    syncClass,
				"data-ref": "syncStatus",
			}, p.SyncMsg),
		),
		h("p", map[string]any{"class": "tagline"},
			"Built with ",
			h("a", map[string]any{
				"href":   "https://github.com/seriva/gofront",
				"target": "_blank",
			}, h("strong", nil, "GoFront")),
			" — Go compiled to JS",
		),
	)
}

func InputRow(p InputRowProps) VNode {
	inputClass := "todo-input"
	placeholder := "What needs to be done?"
	if p.HighPriority {
		inputClass += " high"
		placeholder = "What's urgent? (high priority)"
	}

	priorityBtnClass := "priority-btn"
	priorityLabel := "⚡ Normal"
	if p.HighPriority {
		priorityBtnClass += " on"
		priorityLabel = "⚡ High"
	}

	var priorityHint any
	if p.HighPriority {
		priorityHint = h("span", map[string]any{
			"class": "priority-hint",
			"style": "display: block",
		}, "⚡ High priority — task will be marked urgent")
	}

	var errorSpan any
	if p.ErrorMsg != "" {
		errorSpan = h("span", map[string]any{"class": "error-msg"}, p.ErrorMsg)
	}

	return h("div", map[string]any{"class": "input-row"},
		h("input", map[string]any{
			"type":         "text",
			"class":        inputClass,
			"autocomplete": "off",
			"placeholder":  placeholder,
			"value":        p.Value,
			"disabled":     p.Saving,
			"onInput":      p.OnInput,
			"onKeyDown":    p.OnKeyDown,
		}),
		h("button", map[string]any{
			"type":  "button",
			"class": priorityBtnClass,
			"onClick": func(e any) {
				if p.OnTogglePriority != nil {
					p.OnTogglePriority()
				}
			},
		}, priorityLabel),
		h("button", map[string]any{
			"type":     "button",
			"class":    "add-btn",
			"disabled": p.Saving,
			"onClick": func(e any) {
				if p.OnAdd != nil {
					p.OnAdd()
				}
			},
		}, "Add"),
		priorityHint,
		errorSpan,
	)
}

func Footer(p FooterProps) VNode {
	footerStyle := ""
	if p.Total == 0 {
		footerStyle = "display: none"
	}

	btnAll := "filter-btn"
	if p.Filter == FilterAll {
		btnAll += " active"
	}
	btnActive := "filter-btn"
	if p.Filter == FilterActive {
		btnActive += " active"
	}
	btnCompleted := "filter-btn"
	if p.Filter == FilterCompleted {
		btnCompleted += " active"
	}

	var clearBtn any
	if p.Completed > 0 {
		clearBtn = h("button", map[string]any{
			"type":        "button",
			"class":       "clear-btn",
			"data-action": "clear-completed",
			"onClick": func(e any) {
				if p.OnClearCompleted != nil {
					p.OnClearCompleted()
				}
			},
		}, "Clear ("+String(p.Completed)+")")
	}

	return h("footer", map[string]any{
		"class": "footer",
		"style": footerStyle,
	},
		h("span", map[string]any{"class": "count"},
			utils.Plural(p.Remaining, "task")+" left",
		),
		h("div", map[string]any{"class": "filter-area"},
			h("div", map[string]any{"class": "filter-bar"},
				h("button", map[string]any{
					"type":        "button",
					"class":       btnAll,
					"data-action": "filter",
					"data-filter": "0",
					"onClick": func(e any) {
						if p.OnFilter != nil {
							p.OnFilter(FilterAll)
						}
					},
				}, "All"),
				h("button", map[string]any{
					"type":        "button",
					"class":       btnActive,
					"data-action": "filter",
					"data-filter": "1",
					"onClick": func(e any) {
						if p.OnFilter != nil {
							p.OnFilter(FilterActive)
						}
					},
				}, "Active"),
				h("button", map[string]any{
					"type":        "button",
					"class":       btnCompleted,
					"data-action": "filter",
					"data-filter": "2",
					"onClick": func(e any) {
						if p.OnFilter != nil {
							p.OnFilter(FilterCompleted)
						}
					},
				}, "Completed"),
			),
			clearBtn,
		),
	)
}

func StatsBar(p StatsBarProps) VNode {
	return h("div", map[string]any{"id": "stats-bar"},
		h("div", nil,
			h("span", map[string]any{
				"style": "cursor: pointer",
				"title": "Show active todos",
				"onClick": func(e any) {
					if p.OnClick != nil {
						p.OnClick()
					}
				},
			},
				h("strong", nil, String(p.Total)),
				" "+utils.Plural(p.Total, "todo")+" in session",
			),
		),
	)
}
