package main

import "./utils"
import "js:./browser.d.ts"

// ── Package-level state ───────────────────────────────────────

var todos         []Todo
var nextId        int
var currentFilter int

// ── Persistence ───────────────────────────────────────────────

// saveTodos simulates an async save (e.g. a network round-trip) then
// persists the todo list to localStorage.
async func saveTodos() error {
    await sleep(350)
    localStorage.setItem("todos", JSON.stringify(todos))
    return nil
}

// loadTodos restores the todo list from localStorage on startup.
// Returns an error if the stored data cannot be parsed.
async func loadTodos() error {
    raw := localStorage.getItem("todos")
    if raw == nil {
        return nil
    }
    parsed := JSON.parse(raw)
    if parsed == nil {
        return error("failed to parse stored todos")
    }
    for _, raw := range parsed {
        todos = append(todos, Todo{id: raw.id, text: raw.text, done: raw.done, priority: raw.priority})
    }
    if len(todos) > 0 {
        last := todos[len(todos)-1]
        nextId = last.id + 1
    }
    return nil
}

// ── Mutations ─────────────────────────────────────────────────

func addTodo(text string, priority int) {
    todos = append(todos, Todo{id: nextId, text: text, done: false, priority: priority})
    nextId++
}

func toggleTodo(id int) {
    for i := 0; i < len(todos); i++ {
        if todos[i].id == id {
            todos[i].done = !todos[i].done
        }
    }
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
    currentFilter = f
}

// moveTodo moves the item with fromId to just before the item with toId.
// If toId is not found (dropped after the last item) the item is appended.
func moveTodo(fromId int, toId int) {
    if fromId == toId {
        return
    }
    // Pull the dragged item out of the slice.
    var item Todo
    var rest []Todo
    for _, t := range todos {
        if t.id == fromId {
            item = t
        } else {
            rest = append(rest, t)
        }
    }
    // Re-insert before the drop target.
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

// ── Queries ───────────────────────────────────────────────────

// visibleTodos returns only the todos that match the current filter.
func visibleTodos() []Todo {
    switch currentFilter {
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
        return todos
    }
}

// stats returns the number of remaining and completed todos.
// Named return values let the bare return carry both counts at once.
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

// statusLine builds the footer summary string using the utils sub-package.
func statusLine() string {
    remaining, _ := stats()
    return utils.Plural(remaining, "task") + " left"
}

// highCount returns the number of high-priority incomplete todos,
// using utils.Max to demonstrate a cross-package utility call.
func highCount() int {
    n := 0
    for _, t := range todos {
        if t.priority == PriorityHigh && !t.done {
            n++
        }
    }
    return utils.Max(n, 0)
}
