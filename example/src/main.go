package main

// highPriority tracks whether the next todo will be high-priority.
var highPriority bool

func togglePriorityMode() {
    highPriority = !highPriority
    btn := document.getElementById("priority-btn")
    if highPriority {
        btn.className   = "priority-btn on"
        btn.textContent = "⚡ High"
    } else {
        btn.className   = "priority-btn"
        btn.textContent = "⚡ Normal"
    }
}

func validateTodo(text string) error {
    if text == "" {
        return error("todo text cannot be empty")
    }
    return nil
}

// setSyncStatus briefly shows a save status indicator in the header.
func setSyncStatus(msg string, cls string) {
    el := document.getElementById("sync-status")
    el.textContent = msg
    el.className   = "sync-status " + cls
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

// submitInput validates, adds, and asynchronously saves the new todo.
async func submitInput() {
    input := document.getElementById("todo-input")
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

async func main() {
    input       := document.getElementById("todo-input")
    addBtn      := document.getElementById("add-btn")
    priorityBtn := document.getElementById("priority-btn")

    addBtn.addEventListener("click", func() {
        submitInput()
    })

    input.addEventListener("keydown", func(e any) {
        if e.key == "Enter" {
            submitInput()
        }
    })

    priorityBtn.addEventListener("click", func() {
        togglePriorityMode()
    })

    // Restore persisted todos; fall back to seed data if storage is empty.
    loadErr := await loadTodos()
    if loadErr != nil || len(todos) == 0 {
        addTodo("Read the GoWeb docs",             PriorityNormal)
        addTodo("Fix the critical production bug", PriorityHigh)
        addTodo("Write tests",                     PriorityNormal)
        addTodo("Deploy to staging",               PriorityHigh)
        addTodo("Send weekly update email",        PriorityNormal)
        toggleTodo(0)
    }

    render()
}
