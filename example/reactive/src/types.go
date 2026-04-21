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
    id       int    `json:"id"`
    text     string `json:"text"`
    done     bool   `json:"done"`
    priority int    `json:"priority"`
}

func (t Todo) isUrgent() bool {
    return t.priority == PriorityHigh && !t.done
}

func (t Todo) withDone(done bool) Todo {
    return Todo{t.id, t.text, done, t.priority}
}

// ── Stats ─────────────────────────────────────────────────────

type Stats struct {
    remaining int
    completed int
}

// ── AppElements ───────────────────────────────────────────────
// References to key DOM elements, populated from comp.refs.* inside
// createAppShell's mount() hook — no querySelector or getElementById needed.

type AppElements struct {
    input       any
    addBtn      any
    priorityBtn any
    list        any
    footer      any
    badge       any
    syncStatus  any
    inputRow    any // .input-row — scan attributes resolved via Component state
    countSpan   any // .count <span>      — bound by ctx.bindMultiple
    filterArea  any // .filter-area <div> — bound for filter buttons + clear
}
