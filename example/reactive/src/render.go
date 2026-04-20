package main

import "./utils"

// dragSrcId holds the id of the todo currently being dragged.
var dragSrcId int

// ── HTML builders (SafeHTML via trusted()) ────────────────────


func renderTodoHTML(t Todo) SafeHTML {
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
    return trusted(
        `<li class="` + cls + `" draggable="true" data-id="` + id + `">
<input type="checkbox" class="todo-cb" data-action="toggle" data-todo-id="` + id + `"` + checked + ` />
<span class="todo-text">` + html.EscapeString(t.text) + `</span>` +
        badge +
        `<button class="del-btn" data-action="delete" data-todo-id="` + id + `">✕</button>
</li>`,
    )
}

func renderFilterBarHTML(activeFilter int) SafeHTML {
    filters := [...]int{FilterAll, FilterActive, FilterCompleted}
    out := `<div class="filter-bar">`
    for _, f := range filters {
        cls := "filter-btn"
        if f == activeFilter {
            cls = "filter-btn active"
        }
        out = out + `<button class="` + cls + `" data-action="filter" data-filter="` + String(f) + `">` +
            filterLabel(f) + `</button>`
    }
    out = out + `</div>`
    return trusted(out)
}

// ── App shell ─────────────────────────────────────────────────

// createAppShell builds the full DOM structure and mounts it into #app.
// Returns references to the key elements for reactive binding.
func createAppShell() AppElements {
    app := document.getElementById("app")
    app.innerHTML = trusted(`<div class="card">
  <header class="header">
    <div class="header-top">
      <div class="header-icon">✓</div>
      <h1>Todos Reactive</h1>
      <span class="high-badge"></span>
      <span class="sync-status"></span>
    </div>
    <p class="tagline">Built with <a href="https://github.com/seriva/gofront" target="_blank"><strong>GoFront</strong></a> — Go compiled to JS</p>
  </header>
  <div class="input-row">
    <input class="todo-input" type="text" placeholder="What needs to be done?" autocomplete="off" />
    <button type="button" class="priority-btn">⚡ Normal</button>
    <button type="button" class="add-btn">Add</button>
  </div>
  <div class="list-divider"></div>
  <ul class="todo-list"></ul>
  <footer class="footer"></footer>
</div>`).content

    return AppElements{
        input:       app.querySelector(".todo-input"),
        addBtn:      app.querySelector(".add-btn"),
        priorityBtn: app.querySelector(".priority-btn"),
        list:        app.querySelector(".todo-list"),
        footer:      app.querySelector(".footer"),
        badge:       app.querySelector(".high-badge"),
        syncStatus:  app.querySelector(".sync-status"),
    }
}

// ── Reactive DOM wiring ───────────────────────────────────────

// setupReactiveDOM wires up signals → DOM using Reactive.bind and
// Signals.computed. Each signal change automatically re-renders the
// relevant section — no manual DOM management required.
func setupReactiveDOM(els AppElements) {
    ctx := Reactive.createComponent()

    // List: computed from visibleSignal
    listView := ctx.computed(func() any {
        visible := visibleSignal.get()
        if len(visible) == 0 {
            return trusted(`<li class="empty">Nothing here.</li>`)
        }
        items := []SafeHTML{}
        for i := range len(visible) {
            items = append(items, renderTodoHTML(visible[i]))
        }
        return join(items, "")
    }, "listView")

    // Footer: computed from todosSignal, statsSignal, filterSignal
    footerView := ctx.computed(func() any {
        todos := todosSignal.get()
        if len(todos) == 0 {
            return trusted("")
        }
        s := statsSignal.get()
        countText := utils.Plural(s.remaining, "task") + " left"
        f := filterSignal.get()

        clearBtn := ""
        if s.completed > 0 {
            clearBtn = `<button class="clear-btn" data-action="clear-completed">Clear completed (` +
                String(s.completed) + `)</button>`
        }
        return trusted(`<span class="count">` + html.EscapeString(countText) + `</span>` +
            renderFilterBarHTML(f).content + clearBtn)
    }, "footerView")

    // Badge: computed from highCountSignal
    badgeView := ctx.computed(func() any {
        hc := highCountSignal.get()
        if hc > 0 {
            els.badge.style.display = "inline-block"
            return trusted(String(hc) + ` urgent`)
        }
        els.badge.style.display = "none"
        return trusted("")
    }, "badgeView")

    // Bind computed signals → DOM elements
    ctx.bind(els.list,   listView,   func(v any) any { return v })
    ctx.bind(els.footer, footerView, func(v any) any { return v })
    ctx.bind(els.badge,  badgeView,  func(v any) any { return v })

    // ── Event delegation ──────────────────────────────────────
    els.list.addEventListener("change", func(e any) {
        action := e.target.getAttribute("data-action")
        if action == "toggle" {
            idStr := e.target.getAttribute("data-todo-id")
            toggleTodo(int(idStr))
            triggerSave(els)
        }
    })

    els.list.addEventListener("click", func(e any) {
        action := e.target.getAttribute("data-action")
        if action == "delete" {
            idStr := e.target.getAttribute("data-todo-id")
            removeTodo(int(idStr))
            triggerSave(els)
        }
    })

    els.footer.addEventListener("click", func(e any) {
        action := e.target.getAttribute("data-action")
        switch action {
        case "filter":
            f := int(e.target.getAttribute("data-filter"))
            setFilter(f)
        case "clear-completed":
            clearCompleted()
            triggerSave(els)
        }
    })

    // ── Drag-and-drop ─────────────────────────────────────────
    els.list.addEventListener("dragstart", func(e any) {
        li := e.target.closest("li")
        if li == nil {
            return
        }
        dragSrcId = int(li.getAttribute("data-id"))
        li.classList.add("dragging")
        e.dataTransfer.effectAllowed = "move"
    })

    els.list.addEventListener("dragover", func(e any) {
        li := e.target.closest("li")
        if li == nil {
            return
        }
        targetId := int(li.getAttribute("data-id"))
        if dragSrcId != targetId {
            e.preventDefault()
            li.classList.add("drag-over")
        }
    })

    els.list.addEventListener("dragleave", func(e any) {
        li := e.target.closest("li")
        if li == nil {
            return
        }
        if !li.contains(e.relatedTarget) {
            li.classList.remove("drag-over")
        }
    })

    els.list.addEventListener("drop", func(e any) {
        e.preventDefault()
        li := e.target.closest("li")
        if li == nil {
            return
        }
        targetId := int(li.getAttribute("data-id"))
        if dragSrcId != targetId {
            moveTodo(dragSrcId, targetId)
            triggerSave(els)
        }
    })

    els.list.addEventListener("dragend", func(e any) {
        li := e.target.closest("li")
        if li != nil {
            li.classList.remove("dragging")
        }
    })
}
