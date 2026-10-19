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
		if err := validateTodo("Build Preact UI"); err != nil {
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
	td := Todo{ID: 1, Text: "Important task", Done: false, Priority: PriorityHigh}
	if !td.isUrgent() {
		t.Error("expected high priority incomplete task to be urgent")
	}

	doneTd := td.withDone(true)
	if !doneTd.Done {
		t.Error("expected withDone(true) to set done = true")
	}
	if doneTd.isUrgent() {
		t.Error("expected completed task to not be urgent")
	}

	renamedTd := td.withText("Updated task")
	if renamedTd.Text != "Updated task" {
		t.Errorf("expected withText to update text, got %q", renamedTd.Text)
	}
}

func TestMoveTodo(t *testing.T) {
	initial := []Todo{
		{ID: 1, Text: "One"},
		{ID: 2, Text: "Two"},
		{ID: 3, Text: "Three"},
	}

	// Move item 1 after item 2
	moved := moveTodo(initial, 1, 2, true)
	if len(moved) != 3 || moved[0].ID != 2 || moved[1].ID != 1 || moved[2].ID != 3 {
		t.Errorf("unexpected move result: %v", moved)
	}

	// Move item 3 before item 1
	moved2 := moveTodo(initial, 3, 1, false)
	if len(moved2) != 3 || moved2[0].ID != 3 || moved2[1].ID != 1 || moved2[2].ID != 2 {
		t.Errorf("unexpected move result: %v", moved2)
	}
}
