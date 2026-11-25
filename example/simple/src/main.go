package main

import (
    "errors"
    "gofront/dom"
    "strconv"
    "unicode/utf8"

    "./utils"
    "js:./browser.d.ts"
)

const maxTodoLen = 120

// attrInt reads the integer attribute name of el, or 0 when it is missing.
func attrInt(el dom.Element, name string) int {
    n, _ := strconv.Atoi(el.getAttribute(name))
    return n
}

func validateTodo(text string) error {
    if !utils.HasText(text) {
        return errors.New("todo text cannot be empty")
    }
    if utf8.RuneCountInString(text) > maxTodoLen {
        return errors.New("todo text too long")
    }
    return nil
}

// setSyncStatus briefly shows a save status indicator.
func setSyncStatus(msg string, cls string) {
    el := document.querySelector(".sync-status")
    el.textContent = msg
    el.className = "sync-status " + cls
}

// triggerSave persists todos and briefly shows a status indicator.
async func triggerSave() {
    setSyncStatus("Saving…", "saving")
    err := await saveTodos()
    if err != nil {
        setSyncStatus("Save failed", "error")
        return
    }
    setSyncStatus("Saved ✓", "saved")
    await sleep(1500)
    setSyncStatus("", "")
}

// submitInput validates, adds, and saves a new todo.
async func submitInput() {
    input := document.querySelector(".todo-input").(dom.HTMLInputElement)
    defer input.focus()

    err := validateTodo(input.value)
    if err != nil {
        return
    }

    priority := PriorityNormal
    if highPriority {
        priority = PriorityHigh
    }
    addTodo(input.value, priority)
    input.value = ""
    if highPriority {
        togglePriorityMode()
    }
    render()
    await triggerSave()
}

func togglePriorityMode() {
    highPriority = !highPriority
    btn := document.querySelector(".priority-btn")
    if highPriority {
        btn.className   = "priority-btn on"
        btn.textContent = "⚡ High"
    } else {
        btn.className   = "priority-btn"
        btn.textContent = "⚡ Normal"
    }
}

// ── App startup ───────────────────────────────────────────────

func createApp() {
    app := document.getElementById("app")
    app.innerHTML = `<div class="card">
  <header class="header">
    <div class="header-top">
      <div class="header-icon">✓</div>
      <h1>Todos Simple</h1>
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
</div>`
}

func setupEvents() {
    addBtn      := document.querySelector(".add-btn")
    input       := document.querySelector(".todo-input")
    priorityBtn := document.querySelector(".priority-btn")
    list        := document.querySelector(".todo-list")
    footer      := document.querySelector(".footer")

    addBtn.addEventListener("click", func() {
        submitInput()
    })

    input.addEventListener("keydown", func(e dom.KeyboardEvent) {
        if e.key == "Enter" {
            submitInput()
        }
    })

    priorityBtn.addEventListener("click", func() {
        togglePriorityMode()
    })

    // Event delegation: toggle & delete
    list.addEventListener("change", func(e dom.Event) {
        target := e.target.(dom.Element)
        if target.getAttribute("data-action") == "toggle" {
            toggleTodo(attrInt(target, "data-todo-id"))
            render()
            triggerSave()
        }
    })

    list.addEventListener("click", func(e dom.MouseEvent) {
        target := e.target.(dom.Element)
        if target.getAttribute("data-action") == "delete" {
            removeTodo(attrInt(target, "data-todo-id"))
            render()
            triggerSave()
        }
    })

    // Event delegation: filter & clear
    footer.addEventListener("click", func(e dom.MouseEvent) {
        target := e.target.(dom.Element)
        action := target.getAttribute("data-action")
        switch action {
        case "filter":
            setFilter(attrInt(target, "data-filter"))
            render()
        case "clear-completed":
            clearCompleted()
            render()
            triggerSave()
        case "export-csv":
            _, err := ExportCSV(todos)
            if err == nil {
                setSyncStatus("CSV Exported", "saved")
            }
        }
    })

    // ── Drag-and-drop ─────────────────────────────────────────
    list.addEventListener("dragstart", func(e dom.DragEvent) {
        li := e.target.(dom.Element).closest("li")
        if li == nil { return }
        dragSrcId = attrInt(li, "data-id")
        li.classList.add("dragging")
        e.dataTransfer.effectAllowed = "move"
    })

    list.addEventListener("dragover", func(e dom.DragEvent) {
        li := e.target.(dom.Element).closest("li")
        if li == nil { return }
        targetId := attrInt(li, "data-id")
        if dragSrcId != targetId {
            e.preventDefault()
            rect := li.getBoundingClientRect()
            after := float64(e.clientY) > rect.top+rect.height/2
            li.classList.remove("drag-over-top", "drag-over-bottom")
            if after {
                li.classList.add("drag-over-bottom")
            } else {
                li.classList.add("drag-over-top")
            }
        }
    })

    list.addEventListener("dragleave", func(e dom.DragEvent) {
        li := e.target.(dom.Element).closest("li")
        if li == nil { return }
        if !li.contains(e.relatedTarget.(dom.Node)) {
            li.classList.remove("drag-over-top", "drag-over-bottom")
        }
    })

    list.addEventListener("drop", func(e dom.DragEvent) {
        e.preventDefault()
        li := e.target.(dom.Element).closest("li")
        if li == nil { return }
        targetId := attrInt(li, "data-id")
        if dragSrcId != targetId {
            rect := li.getBoundingClientRect()
            after := float64(e.clientY) > rect.top+rect.height/2
            moveTodo(dragSrcId, targetId, after)
            render()
            triggerSave()
        }
    })

    list.addEventListener("dragend", func(e dom.DragEvent) {
        li := e.target.(dom.Element).closest("li")
        if li != nil {
            li.classList.remove("dragging", "drag-over-top", "drag-over-bottom")
        }
    })
}

async func main() {
    injectStyles()
    createApp()
    setupEvents()

    // Restore persisted todos; seed if empty.
    loadErr := await loadTodos()
    if loadErr != nil || len(todos) == 0 {
        addTodo("Read the GoFront docs",           PriorityNormal)
        addTodo("Fix the critical production bug",  PriorityHigh)
        addTodo("Write tests",                      PriorityNormal)
        addTodo("Deploy to staging",                PriorityHigh)
        addTodo("Send weekly update email",         PriorityNormal)
        toggleTodo(0)
    }

    render()
}
