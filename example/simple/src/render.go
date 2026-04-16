package main

import "./utils"

// dragSrcId holds the id of the todo currently being dragged.
var dragSrcId int

// ── HTML escaping ─────────────────────────────────────────────

func esc(s string) string {
    out := ""
    for _, r := range s {
        switch r {
        case '&':
            out = out + "&amp;"
        case '<':
            out = out + "&lt;"
        case '>':
            out = out + "&gt;"
        case '"':
            out = out + "&quot;"
        default:
            out = out + string(r)
        }
    }
    return out
}

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
<span class="todo-text">` + esc(t.text) + `</span>` +
        badge +
        `<button class="del-btn" data-action="delete" data-todo-id="` + id + `">✕</button>
</li>`
}

func renderFilterBar() string {
    filters := [...]int{FilterAll, FilterActive, FilterCompleted}
    out := `<div class="filter-bar">`
    for _, f := range filters {
        cls := "filter-btn"
        if f == filter {
            cls = "filter-btn active"
        }
        out = out + `<button class="` + cls + `" data-action="filter" data-filter="` + String(f) + `">` +
            filterLabel(f) + `</button>`
    }
    return out + `</div>`
}

func render() {
    // List
    list := document.querySelector(".todo-list")
    visible := visibleTodos()
    if len(visible) == 0 {
        list.innerHTML = `<li class="empty">Nothing here.</li>`
    } else {
        html := ""
        for _, t := range visible {
            html = html + renderTodo(t)
        }
        list.innerHTML = html
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
        footer.innerHTML = `<span class="count">` + esc(countText) + `</span>` +
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
