package main

import "js:./browser.d.ts"

// ── Application state ─────────────────────────────────────────

var todos      []Todo
var nextId     int
var filter     int
var highPriority bool

// ── Persistence (async/await + defer/recover) ─────────────────

func safeJsonParse(raw string) (result any, err error) {
    defer func() {
        if r := recover(); r != nil {
            err = error(r)
        }
    }()
    result = JSON.parse(raw)
    return result, nil
}

async func saveTodos() error {
    localStorage.setItem("todos", JSON.stringify(todos))
    return nil
}

async func loadTodos() error {
    raw := localStorage.getItem("todos")
    if raw == nil {
        return nil
    }
    parsed, parseErr := safeJsonParse(raw)
    if parseErr != nil {
        return parseErr
    }
    if parsed == nil {
        return error("failed to parse stored todos")
    }
    var loaded []Todo
    for _, raw := range parsed {
        loaded = append(loaded, Todo{id: raw.id, text: raw.text, done: raw.done, priority: raw.priority})
    }
    if len(loaded) > 0 {
        last := loaded[len(loaded)-1]
        nextId = last.id + 1
    }
    todos = loaded
    return nil
}

// ── Mutations (slice operations) ──────────────────────────────

func addTodo(text string, priority int) {
    todos = append(todos, Todo{id: nextId, text: text, done: false, priority: priority})
    nextId++
}

func toggleTodo(id int) {
    var next []Todo
    for _, t := range todos {
        if t.id == id {
            next = append(next, t.withDone(!t.done))
        } else {
            next = append(next, t)
        }
    }
    todos = next
}

func removeTodo(id int) {
    var next []Todo
    for _, t := range todos {
        if t.id != id {
            next = append(next, t)
        }
    }
    todos = next
}

func clearCompleted() {
    var next []Todo
    for _, t := range todos {
        if !t.done {
            next = append(next, t)
        }
    }
    todos = next
}

func setFilter(f int) {
    filter = f
}

func moveTodo(fromId int, toId int) {
    if fromId == toId {
        return
    }
    var item Todo
    var rest []Todo
    for _, t := range todos {
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
    todos = result
}

// ── Derived values (multiple returns, for range, switch) ──────

func visibleTodos() []Todo {
    switch filter {
    case FilterActive:
        var out []Todo
        for _, t := range todos {
            if !t.done {
                out = append(out, t)
            }
        }
        return out
    case FilterCompleted:
        var out []Todo
        for _, t := range todos {
            if t.done {
                out = append(out, t)
            }
        }
        return out
    default:
        return append([]Todo{}, todos...)
    }
}

func stats() (remaining int, completed int) {
    for _, t := range todos {
        if t.done {
            completed++
        } else {
            remaining++
        }
    }
    return
}

func highCount() int {
    n := 0
    for _, t := range todos {
        if t.isUrgent() {
            n++
        }
    }
    return n
}
