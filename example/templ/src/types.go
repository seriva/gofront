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

func (t Todo) isUrgent() bool {
	return t.priority == PriorityHigh && !t.done
}

func (t Todo) withDone(done bool) Todo {
	return Todo{t.id, t.text, done, t.priority}
}
