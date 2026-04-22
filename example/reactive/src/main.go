package main

import "unicode/utf8"

const maxTodoLen = 120

func validateTodo(text string) error {
    if !utils.HasText(text) {
        return errors.New("todo text cannot be empty")
    }
    if utf8.RuneCountInString(text) > maxTodoLen {
        return errors.New("todo text too long")
    }
    return nil
}

// submitInput validates, adds, and asynchronously saves the new todo.
// It reads and clears the input through the reactive inputValue signal so
// changes propagate to the DOM via the data-model binding set up by the
// Component scan. On validation failure it sets errorSignal (bound via
// data-if / data-text in the Component template) and auto-clears after 2.5 s.
async func submitInput(input any, inputValue Signal) {
    defer input.focus()

    err := validateTodo(inputValue.get())
    if err != nil {
        errorSignal.set(err.Error())
        await sleep(2500)
        errorSignal.set("")
        return
    }
    errorSignal.set("")

    priority := PriorityNormal
    if highPriority.get() {
        priority = PriorityHigh
    }
    addTodo(inputValue.get(), priority)
    inputValue.set("")

    // signal.update() — toggle highPriority off using the current value
    if highPriority.get() {
        highPriority.update(func(v any) any { return !v })
    }
    await triggerSave()
}

// togglePriorityMode flips highPriority via signal.update().
// The priority button's text, class, and the Add button's colour are all
// driven reactively by bindings in setupReactiveDOM — no DOM access here.
func togglePriorityMode() {
    highPriority.update(func(v any) any { return !v })
}

async func main() {
    // setDebugMode — enable reactive system console logging when ?debug is in the URL.
    if strings.Contains(window.location.search, "debug") {
        setDebugMode(true)
    }


    // Reactive.mount — render a static loading placeholder into #app.
    // Reactive.mount sets innerHTML once (not reactive) — ideal for initial content
    // before async data is ready.
    app    := document.getElementById("app")
    loadEl := document.createElement("div")
    loadEl.setAttribute("style", "display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:200px;color:var(--muted);font-size:.9rem;letter-spacing:.02em;gap:14px")
    app.appendChild(loadEl)
    Reactive.mount(loadEl, func() any {
        return trusted(`<div style="font-size:2rem;opacity:.4">✓</div><span>Loading todos…</span>`)
    })

    // Initialise the reactive store (creates all signals + computedAsync).
    initStore()

    // signal.once() — subscribe and auto-unsubscribe after the first emission.
    // Captures the initial filter preference exactly once at session start.
    filterSignal.once(func(f any) {
        console.log(fmt.Sprintf("[GoFront] Session started — initial filter: %d (0=All 1=Active 2=Done)", f))
    })

    // The input text is a reactive signal so the two-way data-model scan binding
    // can sync it with the <input> element (via data-model in the Component template).
    inputValue := Signals.create("", nil, "inputValue")

    // signal.subscribe() — watch loadStateSignal and react when the async data
    // resolves. We unsubscribe manually inside the callback (fire-once pattern).
    var unsub func()
    unsub = loadStateSignal.subscribe(func(state any) {
        if state.status != "resolved" {
            return
        }
        // Unsubscribe so this fires exactly once.
        if unsub != nil {
            unsub()
        }

        loaded := state.data
        if loaded != nil && len(loaded) > 0 {
            last := loaded[len(loaded)-1]
            nextId = last.id + 1
            todosSignal.set(loaded)
        } else {
            // Seed default todos when localStorage is empty.
            addTodo("Read the GoFront docs",          PriorityNormal)
            addTodo("Fix the critical production bug", PriorityHigh)
            addTodo("Write tests",                     PriorityNormal)
            addTodo("Deploy to staging",               PriorityHigh)
            addTodo("Send weekly update email",        PriorityNormal)
            toggleTodo(0)
        }

        // Remove the loading placeholder and mount the app as a Component.
        // createAppShell wires everything internally via mount() — no separate
        // setup calls and no querySelector / getElementById in application code.
        loadEl.remove()
        createAppShell(inputValue)
    })
}
