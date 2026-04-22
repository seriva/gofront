package main

import "./utils"
import "js:./browser.d.ts"

// ── Reactive state (signals) ──────────────────────────────────

// todosSignal is the source-of-truth signal; all derived views are computed from it.
var todosSignal  Signal
var filterSignal Signal
var nextId       int

// highPriority is a signal so the priority button's appearance and the Add
// button's colour can be driven reactively by setupReactiveDOM.
var highPriority Signal

// savingSignal is true while an async save is in progress.
// Bound to the Add button's disabled attribute via ctx.bindBoolAttr.
var savingSignal Signal

// syncMsgSignal / syncClsSignal drive the sync-status indicator reactively.
// Bound via ctx.bindText and ctx.bindAttr instead of direct DOM manipulation.
var syncMsgSignal Signal
var syncClsSignal Signal

// loadStateSignal tracks the async localStorage read (Signals.computedAsync).
var loadStateSignal Signal

// loadedSignal becomes true once the initial data load is applied to todosSignal.
var loadedSignal Signal

// errorSignal holds the current validation error message; "" means no error.
// Set by submitInput on failure; auto-cleared after a short delay.
var errorSignal Signal

// Derived (computed) signals — automatically updated when dependencies change.
var visibleSignal   Signal
var statsSignal     Signal
var highCountSignal Signal

func initStore() {
    todosSignal  = Signals.create([]Todo{}, nil, "todos")
    filterSignal = Signals.create(FilterAll, nil, "filter")
    highPriority = Signals.create(false, nil, "highPriority")
    savingSignal = Signals.create(false, nil, "saving")
    syncMsgSignal = Signals.create("", nil, "syncMsg")
    syncClsSignal = Signals.create("", nil, "syncCls")
    loadedSignal  = Signals.create(false, nil, "loaded")
    errorSignal   = Signals.create("", nil, "error")

    // computedAsync: reads todos from localStorage asynchronously so the
    // loading placeholder is displayed before parsing begins.
    loadStateSignal = Signals.computedAsync(asyncLoadFromStorage, "loadState")

    // Computed: filtered list of visible todos
    visibleSignal = Signals.computed(func() any {
        todos := todosSignal.get()
        f     := filterSignal.get()
        switch f {
        case FilterActive:
            return utils.Filter(todos, func(t Todo) bool { return !t.done })
        case FilterCompleted:
            return utils.Filter(todos, func(t Todo) bool { return t.done })
        default:
            return append([]Todo{}, todos...)
        }
    }, "visible")

    // Computed: { remaining, completed } stats
    statsSignal = Signals.computed(func() any {
        remaining := 0
        completed := 0
        for _, t := range todosSignal.get() {
            if t.done {
                completed++
            } else {
                remaining++
            }
        }
        return Stats{remaining: remaining, completed: completed}
    }, "stats")

    // Computed: number of urgent, incomplete tasks
    highCountSignal = Signals.computed(func() any {
        urgent := utils.Filter(todosSignal.get(), func(t Todo) bool { return t.isUrgent() })
        return len(urgent)
    }, "highCount")
}

// ── Async storage loader ──────────────────────────────────────

// asyncLoadFromStorage is the computation function for Signals.computedAsync.
// It is an async function so the reactive library can cancel it if dependencies
// change, and so the loading placeholder remains visible for at least one frame.
async func asyncLoadFromStorage(cancel any) any {
    // Small delay so the loading placeholder is clearly visible to the user
    // and to honour the computedAsync cancellation contract.
    await sleep(200)
    if cancel.cancelled {
        return nil
    }
    raw := localStorage.getItem("todos")
    if raw == nil {
        return nil
    }
    parsed, parseErr := safeJsonParse(raw)
    if parseErr != nil || parsed == nil {
        return nil
    }
    var loaded []Todo
    for _, item := range parsed {
        loaded = append(loaded, Todo{id: item.id, text: item.text, done: item.done, priority: item.priority})
    }
    return loaded
}

// ── Persistence ───────────────────────────────────────────────

// saveTodos persists the todos list to localStorage.
// Uses todosSignal.peek() to read the value without registering
// a reactive dependency — correct since this is an imperative, not reactive, read.
// Manages savingSignal so the UI can disable the Add button while saving.
async func saveTodos() error {
    savingSignal.set(true)
    await sleep(350)
    localStorage.setItem("todos", JSON.stringify(todosSignal.peek()))
    savingSignal.set(false)
    return nil
}

func safeJsonParse(raw string) (result any, err error) {
    defer func() {
        if r := recover(); r != nil {
            err = errors.New(fmt.Sprintf("%v", r))
        }
    }()
    result = JSON.parse(raw)
    return result, nil
}

// ── Sync status ───────────────────────────────────────────────

// setSyncStatus updates the sync signals instead of touching the DOM directly.
// The DOM is driven reactively by ctx.bindText + ctx.bindAttr in setupReactiveDOM.
func setSyncStatus(msg string, cls string) {
    syncMsgSignal.set(msg)
    syncClsSignal.set(cls)
}

// triggerSave persists todos and updates sync-status signals.
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

// ── Mutations ─────────────────────────────────────────────────
// Each mutation uses Signals.batch or signal.update to coalesce updates.

func addTodo(text string, priority int) {
    Signals.batch(func() any {
        cur := todosSignal.get()
        todosSignal.set(append(cur, Todo{id: nextId, text: text, done: false, priority: priority}))
        nextId++
        return nil
    })
}

// toggleTodo uses signal.update() to derive the next state from the current one,
// avoiding a separate get()+set() pair.
func toggleTodo(id int) {
    todosSignal.update(func(cur any) any {
        var next []Todo
        for _, t := range cur {
            if t.id == id {
                next = append(next, t.withDone(!t.done))
            } else {
                next = append(next, t)
            }
        }
        return next
    })
}

func removeTodo(id int) {
    cur := todosSignal.get()
    todosSignal.set(utils.Filter(cur, func(t Todo) bool { return t.id != id }))
}

func clearCompleted() {
    cur := todosSignal.get()
    todosSignal.set(utils.Filter(cur, func(t Todo) bool { return !t.done }))
}

func setFilter(f int) {
    filterSignal.set(f)
}

func moveTodo(fromId int, toId int, after bool) {
    if fromId == toId {
        return
    }
    cur := todosSignal.get()
    var item Todo
    var rest []Todo
    for _, t := range cur {
        if t.id == fromId {
            item = t
        } else {
            rest = append(rest, t)
        }
    }
    var result []Todo
    inserted := false
    for _, t := range rest {
        if !after && t.id == toId {
            result = append(result, item)
            inserted = true
        }
        result = append(result, t)
        if after && t.id == toId {
            result = append(result, item)
            inserted = true
        }
    }
    if !inserted {
        result = append(result, item)
    }
    todosSignal.set(result)
}

// ── Convenience accessors ─────────────────────────────────────

func statusLine() string {
    s := statsSignal.get()
    return utils.Plural(s.remaining, "task") + " left"
}
