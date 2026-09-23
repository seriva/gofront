package main

import (
	"strings"
	"testing"
)

func resetGomStore() {
	todos = []Todo{}
	nextId = 0
	filter = FilterAll
	highPriority = false
}

func TestGomAddAndToggleTodo(t *testing.T) {
	resetGomStore()

	addTodo("Write Gom component", PriorityNormal)
	addTodo("Release GoFront v1.2", PriorityHigh)

	if len(todos) != 2 {
		t.Fatalf("expected 2 todos, got %d", len(todos))
	}

	if todos[0].text != "Write Gom component" || todos[0].done {
		t.Errorf("unexpected first todo: %+v", todos[0])
	}
	if todos[1].text != "Release GoFront v1.2" || !todos[1].isUrgent() {
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

func TestGomRemoveAndClearCompleted(t *testing.T) {
	resetGomStore()

	addTodo("Task A", PriorityNormal)
	addTodo("Task B", PriorityHigh)
	addTodo("Task C", PriorityNormal)

	toggleTodo(todos[1].id) // Mark Task B completed

	rem, comp := stats()
	if rem != 2 || comp != 1 {
		t.Errorf("expected 2 remaining and 1 completed, got %d rem, %d comp", rem, comp)
	}

	removeTodo(todos[0].id) // Remove Task A
	if len(todos) != 2 {
		t.Fatalf("expected 2 todos after remove, got %d", len(todos))
	}

	clearCompleted() // Clears Task B
	if len(todos) != 1 {
		t.Fatalf("expected 1 todo after clearCompleted, got %d", len(todos))
	}
	if todos[0].text != "Task C" {
		t.Errorf("expected Task C remaining, got %q", todos[0].text)
	}
}

func TestGomVisibleTodos(t *testing.T) {
	resetGomStore()

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

func TestGomValidateTodo(t *testing.T) {
	t.Run("empty string", func(t *testing.T) {
		if err := validateTodo(""); err == nil {
			t.Error("expected error for empty string")
		}
	})

	t.Run("whitespace only", func(t *testing.T) {
		if err := validateTodo("   "); err == nil {
			t.Error("expected error for whitespace only")
		}
	})

	t.Run("valid text", func(t *testing.T) {
		if err := validateTodo("Build something awesome"); err != nil {
			t.Errorf("unexpected error for valid todo: %v", err)
		}
	})

	t.Run("exceeds max length", func(t *testing.T) {
		longText := strings.Repeat("x", maxTodoLen+1)
		if err := validateTodo(longText); err == nil {
			t.Error("expected error for text exceeding maxTodoLen")
		}
	})
}

func TestGomMoveTodo(t *testing.T) {
	resetGomStore()

	addTodo("First", PriorityNormal)
	addTodo("Second", PriorityNormal)
	addTodo("Third", PriorityNormal)

	firstId := todos[0].id
	thirdId := todos[2].id

	// Move first item after third
	moveTodo(firstId, thirdId, true)

	if todos[0].text != "Second" || todos[1].text != "Third" || todos[2].text != "First" {
		t.Errorf("unexpected order after move: %v, %v, %v", todos[0].text, todos[1].text, todos[2].text)
	}
}

func TestGomHighCount(t *testing.T) {
	resetGomStore()

	addTodo("Normal 1", PriorityNormal)
	addTodo("High 1", PriorityHigh)
	addTodo("High 2", PriorityHigh)

	if highCount() != 2 {
		t.Errorf("expected 2 high priority todos, got %d", highCount())
	}

	// Completing a high priority todo removes it from urgent count
	toggleTodo(todos[1].id)
	if highCount() != 1 {
		t.Errorf("expected 1 high priority todo after completing one, got %d", highCount())
	}
}

func TestGomMountDOM(t *testing.T) {
	if document == nil {
		t.Skip("skipping DOM test in non-DOM environment")
	}
	container := document.createElement("div")
	node := todoItemNode(Todo{id: 42, text: "Gom DOM task", done: false, priority: PriorityHigh})
	node.Mount(container)

	if container.children.length != 1 {
		t.Fatalf("expected 1 child in container, got %d", container.children.length)
	}

	li := container.children[0]
	if !strings.Contains(li.className, "todo-item high") {
		t.Errorf("expected class 'todo-item high', got %q", li.className)
	}
}

