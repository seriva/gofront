package main

import "testing"

func resetStore() {
	todos = nil
	nextId = 0
	filter = FilterAll
	highPriority = false
}

func TestAddAndToggleTodo(t *testing.T) {
	resetStore()

	addTodo("Buy groceries", PriorityNormal)
	addTodo("Urgent report", PriorityHigh)

	if len(todos) != 2 {
		t.Fatalf("expected 2 todos, got %d", len(todos))
	}

	if todos[0].text != "Buy groceries" || todos[0].done {
		t.Errorf("unexpected first todo: %+v", todos[0])
	}
	if todos[1].text != "Urgent report" || !todos[1].isUrgent() {
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

func TestRemoveAndClearCompleted(t *testing.T) {
	resetStore()

	addTodo("Task 1", PriorityNormal)
	addTodo("Task 2", PriorityNormal)
	addTodo("Task 3", PriorityNormal)

	toggleTodo(todos[1].id) // Mark Task 2 done

	rem, comp := stats()
	if rem != 2 || comp != 1 {
		t.Errorf("expected 2 remaining and 1 completed, got %d rem, %d comp", rem, comp)
	}

	removeTodo(todos[0].id) // Remove Task 1
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

func TestVisibleTodosFilter(t *testing.T) {
	resetStore()

	addTodo("Active 1", PriorityNormal)
	addTodo("Completed 1", PriorityNormal)
	addTodo("Active 2", PriorityHigh)

	toggleTodo(todos[1].id)

	setFilter(FilterAll)
	if len(visibleTodos()) != 3 {
		t.Errorf("FilterAll: expected 3 todos, got %d", len(visibleTodos()))
	}

	setFilter(FilterActive)
	active := visibleTodos()
	if len(active) != 2 {
		t.Errorf("FilterActive: expected 2 todos, got %d", len(active))
	}

	setFilter(FilterCompleted)
	completed := visibleTodos()
	if len(completed) != 1 {
		t.Errorf("FilterCompleted: expected 1 todo, got %d", len(completed))
	}
	if completed[0].text != "Completed 1" {
		t.Errorf("expected 'Completed 1', got %q", completed[0].text)
	}
}

func TestValidateTodo(t *testing.T) {
	if err := validateTodo(""); err == nil {
		t.Error("expected error for empty string")
	}
	if err := validateTodo("   "); err == nil {
		t.Error("expected error for whitespace only")
	}
	if err := validateTodo("Valid todo"); err != nil {
		t.Errorf("unexpected error for valid text: %v", err)
	}
}
