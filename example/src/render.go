package main

import "./utils"

// dragSrcId holds the id of the todo currently being dragged.
var dragSrcId int

// ── Todo item ─────────────────────────────────────────────────

func renderTodo(t Todo) any {
    id := t.id

    li := document.createElement("li")
    li.className = t.priorityClass()
    if t.done {
        li.className = "todo-item done"
    }

    // ── Drag-and-drop ─────────────────────────────────────────
    li.setAttribute("draggable", "true")

    li.addEventListener("dragstart", func(e any) {
        dragSrcId = id
        li.classList.add("dragging")
        e.dataTransfer.effectAllowed = "move"
    })

    li.addEventListener("dragover", func(e any) {
        if dragSrcId != id {
            e.preventDefault()
            li.classList.add("drag-over")
        }
    })

    li.addEventListener("dragleave", func(e any) {
        if !li.contains(e.relatedTarget) {
            li.classList.remove("drag-over")
        }
    })

    li.addEventListener("drop", func(e any) {
        e.preventDefault()
        if dragSrcId != id {
            moveTodo(dragSrcId, id)
            triggerSave()
        }
    })

    li.addEventListener("dragend", func(e any) {
        li.classList.remove("dragging")
        render()
    })

    // Checkbox
    cb := document.createElement("input")
    cb.setAttribute("type", "checkbox")
    cb.checked = t.done
    cb.className = "todo-cb"
    cb.addEventListener("change", func() {
        toggleTodo(id)
        render()
    })

    // Text label
    label := document.createElement("span")
    label.className = "todo-text"
    label.textContent = t.text

    // Priority badge (high-priority items only)
    if t.priority == PriorityHigh && !t.done {
        badge := document.createElement("span")
        badge.className = "badge"
        badge.textContent = "urgent"
        li.appendChild(badge)
    }

    // Delete button
    del := document.createElement("button")
    del.className = "del-btn"
    del.textContent = "✕"
    del.addEventListener("click", func() {
        removeTodo(id)
        render()
    })

    li.appendChild(cb)
    li.appendChild(label)
    li.appendChild(del)
    return li
}

// ── Filter bar ────────────────────────────────────────────────

func renderFilterBar(bar any) {
    filters := [...]int{FilterAll, FilterActive, FilterCompleted}
    for _, f := range filters {
        btn := document.createElement("button")
        btn.textContent = filterLabel(f)
        if f == currentFilter {
            btn.className = "filter-btn active"
        } else {
            btn.className = "filter-btn"
        }
        captured := f
        btn.addEventListener("click", func() {
            setFilter(captured)
            render()
        })
        bar.appendChild(btn)
    }
}

// ── Footer ────────────────────────────────────────────────────

func renderFooter(footer any) {
    remaining, completed := stats()

    // Left: task count via utils.Plural
    count := document.createElement("span")
    count.className = "count"
    count.textContent = utils.Plural(remaining, "task") + " left"
    footer.appendChild(count)

    // Centre: filter buttons
    bar := document.createElement("div")
    bar.className = "filter-bar"
    renderFilterBar(bar)
    footer.appendChild(bar)

    // Right: "Clear completed" only when there are completed items
    if completed > 0 {
        clear := document.createElement("button")
        clear.className = "clear-btn"
        clear.textContent = "Clear completed (" + String(completed) + ")"
        clear.addEventListener("click", func() {
            clearCompleted()
            render()
        })
        footer.appendChild(clear)
    }
}

// ── Main render ───────────────────────────────────────────────

func render() {
    list   := document.getElementById("todo-list")
    footer := document.getElementById("footer")

    list.innerHTML   = ""
    footer.innerHTML = ""

    visible := visibleTodos()
    if len(visible) == 0 {
        empty := document.createElement("li")
        empty.className   = "empty"
        empty.textContent = "Nothing here."
        list.appendChild(empty)
    } else {
        for i := range len(visible) {
            list.appendChild(renderTodo(visible[i]))
        }
    }

    if len(todos) > 0 {
        renderFooter(footer)
    }

    // Update header badge showing high-priority incomplete count
    badge := document.getElementById("high-badge")
    hc    := highCount()
    if hc > 0 {
        badge.textContent = String(hc) + " urgent"
        badge.style.display = "inline-block"
    } else {
        badge.style.display = "none"
    }
}
