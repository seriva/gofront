package main

import "./utils"
import "js:./browser.d.ts"

// ── Reactive state (signals) ──────────────────────────────────

// todosSignal is the source-of-truth signal; all derived views are computed from it.
var todosSignal   Signal
var filterSignal  Signal
var nextId        int
var highPriority  bool

// Derived (computed) signals — automatically updated when dependencies change.
var visibleSignal  Signal
var statsSignal    Signal
var highCountSignal Signal

func initStore() {
    todosSignal  = Signals.create([]Todo{}, nil, "todos")
    filterSignal = Signals.create(FilterAll, nil, "filter")

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
        return max(len(urgent), 0)
    }, "highCount")
}

// ── Persistence ───────────────────────────────────────────────

async func saveTodos() error {
    await sleep(350)
    localStorage.setItem("todos", JSON.stringify(todosSignal.get()))
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

async func loadTodos() error {
    raw := localStorage.getItem("todos")
    if raw == nil {
        return nil
    }
    parsed, parseErr := safeJsonParse(raw)
    if parseErr != nil {
        return fmt.Errorf("invalid stored todos: %w", parseErr)
    }
    if parsed == nil {
        return errors.New("failed to parse stored todos")
    }
    var loaded []Todo
    for _, raw := range parsed {
        loaded = append(loaded, Todo{id: raw.id, text: raw.text, done: raw.done, priority: raw.priority})
    }
    if len(loaded) > 0 {
        last := loaded[len(loaded)-1]
        nextId = last.id + 1
    }
    todosSignal.set(loaded)
    return nil
}

// ── Mutations ─────────────────────────────────────────────────
// Each mutation uses Signals.batch to coalesce updates when doing
// multiple signal writes, ensuring computed signals recompute once.

func addTodo(text string, priority int) {
    Signals.batch(func() any {
        cur := todosSignal.get()
        todosSignal.set(append(cur, Todo{id: nextId, text: text, done: false, priority: priority}))
        nextId++
        return nil
    })
}

func toggleTodo(id int) {
    cur := todosSignal.get()
    var next []Todo
    for _, t := range cur {
        if t.id == id {
            next = append(next, t.withDone(!t.done))
        } else {
            next = append(next, t)
        }
    }
    todosSignal.set(next)
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

func moveTodo(fromId int, toId int) {
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
        if t.id == toId {
            result = append(result, item)
            inserted = true
        }
        result = append(result, t)
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
