package main

// ── Filter mode ───────────────────────────────────────────────

const (
    FilterAll = iota
    FilterActive
    FilterCompleted
)

func filterLabel(f int) string {
    switch f {
    case FilterAll:
        return "All"
    case FilterActive:
        return "Active"
    case FilterCompleted:
        return "Completed"
    default:
        return ""
    }
}

// ── Priority ──────────────────────────────────────────────────

const (
    PriorityNormal = iota
    PriorityHigh
)

// ── Todo ──────────────────────────────────────────────────────

type Todo struct {
    id       int
    text     string
    done     bool
    priority int
}

func (t Todo) priorityClass() string {
    if t.priority == PriorityHigh {
        return "todo-item high"
    }
    return "todo-item"
}
