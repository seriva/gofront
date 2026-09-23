package main

import (
	"strings"
	"testing"
)

func resetTemplStore() {
	todos = []Todo{}
	nextId = 0
	filter = FilterAll
	highPriority = false
}

func TestTemplAddAndToggleTodo(t *testing.T) {
	resetTemplStore()

	addTodo("Write Templ component", PriorityNormal)
	addTodo("Ship GoFront release", PriorityHigh)

	if len(todos) != 2 {
		t.Fatalf("expected 2 todos, got %d", len(todos))
	}

	if todos[0].text != "Write Templ component" || todos[0].done {
		t.Errorf("unexpected first todo: %+v", todos[0])
	}
	if todos[1].text != "Ship GoFront release" || !todos[1].isUrgent() {
		t.Errorf("expected urgent todo for second item")
	}

	toggleTodo(todos[0].id)
	if !todos[0].done {
		t.Errorf("expected todo 0 to be done after toggle")
	}

	toggleTodo(todos[0].id)
	if todos[0].done {
		t.Errorf("expected todo 0 to be undone after second toggle")
	}
}

func TestTemplRemoveAndClearCompleted(t *testing.T) {
	resetTemplStore()

	addTodo("Task 1", PriorityNormal)
	addTodo("Task 2", PriorityHigh)
	addTodo("Task 3", PriorityNormal)

	toggleTodo(todos[1].id)

	rem, comp := stats()
	if rem != 2 || comp != 1 {
		t.Errorf("expected 2 remaining and 1 completed, got %d rem, %d comp", rem, comp)
	}

	removeTodo(todos[0].id)
	if len(todos) != 2 {
		t.Fatalf("expected 2 todos after remove, got %d", len(todos))
	}

	clearCompleted()
	if len(todos) != 1 {
		t.Fatalf("expected 1 todo after clearCompleted, got %d", len(todos))
	}
	if todos[0].text != "Task 3" {
		t.Errorf("expected Task 3 remaining, got %q", todos[0].text)
	}
}

func TestTemplVisibleTodos(t *testing.T) {
	resetTemplStore()

	addTodo("Item 1", PriorityNormal)
	addTodo("Item 2", PriorityHigh)
	addTodo("Item 3", PriorityNormal)
	toggleTodo(todos[1].id)

	setFilter(FilterAll)
	if len(visibleTodos()) != 3 {
		t.Errorf("FilterAll: expected 3, got %d", len(visibleTodos()))
	}

	setFilter(FilterActive)
	active := visibleTodos()
	if len(active) != 2 {
		t.Errorf("FilterActive: expected 2, got %d", len(active))
	}

	setFilter(FilterCompleted)
	completed := visibleTodos()
	if len(completed) != 1 {
		t.Errorf("FilterCompleted: expected 1, got %d", len(completed))
	}
}

func TestTemplValidateTodo(t *testing.T) {
	t.Run("empty string", func(t *testing.T) {
		if err := validateTodo(""); err == nil {
			t.Error("expected error for empty string")
		}
	})

	t.Run("valid text", func(t *testing.T) {
		if err := validateTodo("Testing Templ components"); err != nil {
			t.Errorf("unexpected error: %v", err)
		}
	})

	t.Run("exceeds max length", func(t *testing.T) {
		longText := strings.Repeat("a", maxTodoLen+1)
		if err := validateTodo(longText); err == nil {
			t.Error("expected error for text exceeding maxTodoLen")
		}
	})
}

func TestTemplRenderHelpers(t *testing.T) {
	normalTodo := Todo{id: 1, text: "Normal", done: false, priority: PriorityNormal}
	highTodo := Todo{id: 2, text: "High", done: false, priority: PriorityHigh}
	doneTodo := Todo{id: 3, text: "Done", done: true, priority: PriorityHigh}

	if cls := todoItemClass(normalTodo); cls != "todo-item" {
		t.Errorf("expected 'todo-item', got %q", cls)
	}
	if cls := todoItemClass(highTodo); cls != "todo-item high" {
		t.Errorf("expected 'todo-item high', got %q", cls)
	}
	if cls := todoItemClass(doneTodo); cls != "todo-item done" {
		t.Errorf("expected 'todo-item done', got %q", cls)
	}

	if cls := filterBtnClass(FilterActive, FilterActive); cls != "filter-btn active" {
		t.Errorf("expected active filter button, got %q", cls)
	}
	if cls := filterBtnClass(FilterActive, FilterAll); cls != "filter-btn" {
		t.Errorf("expected inactive filter button, got %q", cls)
	}

	if w := todosWord(1); w != "todo" {
		t.Errorf("expected 'todo' for count 1, got %q", w)
	}
	if w := todosWord(2); w != "todos" {
		t.Errorf("expected 'todos' for count 2, got %q", w)
	}

	if txt := priorityBtnText(true); txt != "⚡ High" {
		t.Errorf("expected '⚡ High', got %q", txt)
	}
	if txt := priorityBtnText(false); txt != "⚡ Normal" {
		t.Errorf("expected '⚡ Normal', got %q", txt)
	}
}

func TestTemplMountDOM(t *testing.T) {
	if document == nil {
		t.Skip("skipping DOM test in non-DOM environment")
	}
	container := document.createElement("div")
	node := TodoItem(Todo{id: 99, text: "Templ DOM task", done: false, priority: PriorityHigh})
	node.Mount(container)

	if container.children.length != 1 {
		t.Fatalf("expected 1 child in container, got %d", container.children.length)
	}

	li := container.children[0]
	if !strings.Contains(li.className, "todo-item high") {
		t.Errorf("expected class 'todo-item high', got %q", li.className)
	}
}

