package main

import "./utils"
import "js:./browser.d.ts"
import "unicode/utf8"

// ── Application state ─────────────────────────────────────────

var todos       = []Todo{}
var nextId      int
var filter      int
var highPriority bool
var dragSrcId  int
var dropAfter  bool

// syncMsg / syncCls drive the sync-status indicator.
// Updated by setSyncStatus; render() reads them to build the node.
var syncMsg string
var syncCls string

// errorMsg holds the current validation error; "" means no error.
var errorMsg string

const maxTodoLen = 120

// ── Validation ────────────────────────────────────────────────

func validateTodo(text string) error {
	if !utils.HasText(text) {
		return errors.New("todo text cannot be empty")
	}
	if utf8.RuneCountInString(text) > maxTodoLen {
		return errors.New("todo text too long")
	}
	return nil
}

// ── Persistence ───────────────────────────────────────────────

func safeJsonParse(raw string) (result any, err error) {
	defer func() {
		if r := recover(); r != nil {
			err = errors.New(fmt.Sprintf("%v", r))
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
	if parseErr != nil || parsed == nil {
		return nil
	}
	var loaded []Todo
	for _, item := range parsed {
		loaded = append(loaded, Todo{id: item.id, text: item.text, done: item.done, priority: item.priority})
	}
	if len(loaded) > 0 {
		last := loaded[len(loaded)-1]
		nextId = last.id + 1
	}
	todos = loaded
	return nil
}

// ── Sync status ───────────────────────────────────────────────

func setSyncStatus(msg string, cls string) {
	syncMsg = msg
	syncCls = cls
}

async func triggerSave() {
	setSyncStatus("Saving…", "saving")
	render()
	err := await saveTodos()
	if err != nil {
		setSyncStatus("Save failed", "error")
		render()
		return
	}
	setSyncStatus("Saved ✓", "saved")
	render()
	await sleep(1500)
	setSyncStatus("", "")
	render()
}

// ── Mutations ─────────────────────────────────────────────────

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
	todos = slices.DeleteFunc(todos, func(t Todo) bool { return t.id == id })
}

func clearCompleted() {
	todos = slices.DeleteFunc(todos, func(t Todo) bool { return t.done })
}

func setFilter(f int) {
	filter = f
}

func moveTodo(fromId int, toId int, after bool) {
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
	todos = result
}

// ── Derived values ────────────────────────────────────────────

func visibleTodos() []Todo {
	switch filter {
	case FilterActive:
		return utils.Filter(todos, func(t Todo) bool { return !t.done })
	case FilterCompleted:
		return utils.Filter(todos, func(t Todo) bool { return t.done })
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
	return len(utils.Filter(todos, func(t Todo) bool { return t.isUrgent() }))
}
