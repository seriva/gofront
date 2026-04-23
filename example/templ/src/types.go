package main

// ── Filter mode ───────────────────────────────────────────────

const (
	FilterAll = iota
	FilterActive
	FilterCompleted
)

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
