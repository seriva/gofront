package main

import "gofront/dom"

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
	ID       int    `json:"id"`
	Text     string `json:"text"`
	Done     bool   `json:"done"`
	Priority int    `json:"priority"`
}

func (t Todo) isUrgent() bool {
	return t.Priority == PriorityHigh && !t.Done
}

func (t Todo) withDone(done bool) Todo {
	return Todo{t.ID, t.Text, done, t.Priority}
}

func (t Todo) withText(text string) Todo {
	return Todo{t.ID, text, t.Done, t.Priority}
}

// ── Stats ─────────────────────────────────────────────────────

type Stats struct {
	remaining int
	completed int
}

// ── Component Props ───────────────────────────────────────────
// Note: Preact shallow-copies props into fresh objects before passing
// them to function components. Any Go struct methods lose their receiver
// binding when passed as props. Therefore, component props must be field-only structs.

type TodoItemProps struct {
	Todo        Todo
	OnToggle    func(int)
	OnDelete    func(int)
	OnEdit      func(int, string)
	OnDragStart func(dom.DragEvent)
	OnDragOver  func(dom.DragEvent)
	OnDrop      func(dom.DragEvent)
	OnDragEnd   func(dom.DragEvent)
}

type HeaderProps struct {
	UrgentCount int
	SyncMsg     string
	SyncCls     string
}

type InputRowProps struct {
	Value            string
	HighPriority     bool
	Saving           bool
	ErrorMsg         string
	OnInput          func(dom.Event)
	OnKeyDown        func(dom.KeyboardEvent)
	OnTogglePriority func()
	OnAdd            func()
}

type FooterProps struct {
	Total            int
	Remaining        int
	Completed        int
	Filter           int
	OnFilter         func(int)
	OnClearCompleted func()
}

type StatsBarProps struct {
	Total   int
	OnClick func()
}
