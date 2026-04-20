package main

import "./utils"

// dragSrcId holds the id of the todo currently being dragged.
var dragSrcId int

// ── Rendering (vanilla DOM via innerHTML) ─────────────────────

func renderTodo(t Todo) string {
    cls := "todo-item"
    if t.done {
        cls = "todo-item done"
    } else if t.isUrgent() {
        cls = "todo-item high"
    }

    checked := ""
    if t.done {
        checked = " checked"
    }

    badge := ""
    if t.isUrgent() {
        badge = `<span class="badge">urgent</span>`
    }

    id := String(t.id)
    return `<li class="` + cls + `" draggable="true" data-id="` + id + `">
<input type="checkbox" class="todo-cb" data-action="toggle" data-todo-id="` + id + `"` + checked + ` />
<span class="todo-text">` + html.EscapeString(t.text) + `</span>` +
        badge +
        `<button class="del-btn" data-action="delete" data-todo-id="` + id + `">✕</button>
</li>`
}

func renderFilterBar() string {
    filters := [...]int{FilterAll, FilterActive, FilterCompleted}
    var b strings.Builder
    b.WriteString(`<div class="filter-bar">`)
    for _, f := range filters {
        cls := "filter-btn"
        if f == filter {
            cls = "filter-btn active"
        }
        b.WriteString(`<button class="` + cls + `" data-action="filter" data-filter="` + String(f) + `">`)
        b.WriteString(filterLabel(f))
        b.WriteString(`</button>`)
    }
    b.WriteString(`</div>`)
    return b.String()
}

func render() {
    // List
    list := document.querySelector(".todo-list")
    visible := visibleTodos()
    if len(visible) == 0 {
        list.innerHTML = `<li class="empty">Nothing here.</li>`
    } else {
        var b strings.Builder
        for _, t := range visible {
            b.WriteString(renderTodo(t))
        }
        list.innerHTML = b.String()
    }

    // Footer
    footer := document.querySelector(".footer")
    if len(todos) == 0 {
        footer.innerHTML = ""
    } else {
        remaining, completed := stats()
        countText := utils.Plural(remaining, "task") + " left"
        clearBtn := ""
        if completed > 0 {
            clearBtn = `<button class="clear-btn" data-action="clear-completed">Clear completed (` +
                String(completed) + `)</button>`
        }
        footer.innerHTML = `<span class="count">` + html.EscapeString(countText) + `</span>` +
            renderFilterBar() + clearBtn
    }

    // Badge
    badge := document.querySelector(".high-badge")
    hc := highCount()
    if hc > 0 {
        badge.style.display = "inline-block"
        badge.textContent = String(hc) + " urgent"
    } else {
        badge.style.display = "none"
        badge.textContent = ""
    }
}
