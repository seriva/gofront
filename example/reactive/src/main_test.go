package main

import (
	"strings"
	"testing"
)

func TestValidateTodo(t *testing.T) {
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
		if err := validateTodo("Build reactive UI"); err != nil {
			t.Errorf("unexpected error: %v", err)
		}
	})

	t.Run("exceeds max length", func(t *testing.T) {
		longText := strings.Repeat("x", maxTodoLen+1)
		if err := validateTodo(longText); err == nil {
			t.Error("expected error for text exceeding maxTodoLen")
		}
	})
}

func TestFilterLabel(t *testing.T) {
	cases := []struct {
		filter int
		want   string
	}{
		{FilterAll, "All"},
		{FilterActive, "Active"},
		{FilterCompleted, "Completed"},
		{999, ""},
	}

	for _, c := range cases {
		got := filterLabel(c.filter)
		if got != c.want {
			t.Errorf("filterLabel(%d) = %q, want %q", c.filter, got, c.want)
		}
	}
}

func TestTodoMethods(t *testing.T) {
	td := Todo{id: 1, text: "Important task", done: false, priority: PriorityHigh}
	if !td.isUrgent() {
		t.Error("expected high priority incomplete task to be urgent")
	}

	doneTd := td.withDone(true)
	if !doneTd.done {
		t.Error("expected withDone(true) to set done = true")
	}
	if doneTd.isUrgent() {
		t.Error("expected completed task to not be urgent")
	}
}
