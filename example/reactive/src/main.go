package main

const maxTodoLen = 120

func validateTodo(text string) error {
    if !utils.HasText(text) {
        return error("todo text cannot be empty")
    }
    if len([]rune(text)) > maxTodoLen {
        return error("todo text too long")
    }
    return nil
}

// setSyncStatus briefly shows a save status indicator.
func setSyncStatus(els AppElements, msg string, cls string) {
    els.syncStatus.textContent = msg
    els.syncStatus.className   = "sync-status " + cls
}

// triggerSave persists todos and briefly shows a status indicator.
async func triggerSave(els AppElements) {
    setSyncStatus(els, "Saving…", "saving")
    err := await saveTodos()
    if err != nil {
        setSyncStatus(els, "Save failed", "error")
        return
    }
    setSyncStatus(els, "Saved ✓", "saved")
    await sleep(1500)
    setSyncStatus(els, "", "")
}

// submitInput validates, adds, and asynchronously saves the new todo.
async func submitInput(els AppElements) {
    defer els.input.focus()

    err := validateTodo(els.input.value)
    if err != nil {
        return
    }

    priority := PriorityNormal
    if highPriority {
        priority = PriorityHigh
    }
    addTodo(els.input.value, priority)
    els.input.value = ""
    if highPriority {
        togglePriorityMode(els)
    }
    await triggerSave(els)
}

func togglePriorityMode(els AppElements) {
    highPriority = !highPriority
    if highPriority {
        els.priorityBtn.className   = "priority-btn on"
        els.priorityBtn.textContent = "⚡ High"
    } else {
        els.priorityBtn.className   = "priority-btn"
        els.priorityBtn.textContent = "⚡ Normal"
    }
}

async func main() {
    // Inject styles and build the DOM structure
    injectStyles()
    els := createAppShell()

    // Initialise reactive store (signals + computed)
    initStore()

    // Wire input events
    els.addBtn.addEventListener("click", func() {
        submitInput(els)
    })

    els.input.addEventListener("keydown", func(e any) {
        if e.key == "Enter" {
            submitInput(els)
        }
    })

    els.priorityBtn.addEventListener("click", func() {
        togglePriorityMode(els)
    })

    // Restore persisted todos; fall back to seed data if storage is empty.
    loadErr := await loadTodos()
    if loadErr != nil || len(todosSignal.get()) == 0 {
        addTodo("Read the GoFront docs",           PriorityNormal)
        addTodo("Fix the critical production bug",  PriorityHigh)
        addTodo("Write tests",                      PriorityNormal)
        addTodo("Deploy to staging",                PriorityHigh)
        addTodo("Send weekly update email",         PriorityNormal)
        toggleTodo(0)
    }

    // Wire up reactive DOM bindings — signals drive the UI from here
    setupReactiveDOM(els)
}
