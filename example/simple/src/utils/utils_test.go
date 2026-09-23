package utils

import "testing"

func TestPlural(t *testing.T) {
	if Plural(1, "item") != "1 item" {
		t.Errorf("expected '1 item', got %q", Plural(1, "item"))
	}
	if Plural(0, "item") != "0 items" {
		t.Errorf("expected '0 items', got %q", Plural(0, "item"))
	}
	if Plural(5, "task") != "5 tasks" {
		t.Errorf("expected '5 tasks', got %q", Plural(5, "task"))
	}
}

func TestHasText(t *testing.T) {
	if !HasText("hello") {
		t.Error("expected 'hello' to have text")
	}
	if HasText("   ") {
		t.Error("expected whitespace to not have text")
	}
	if HasText("") {
		t.Error("expected empty string to not have text")
	}
}

func TestFilter(t *testing.T) {
	nums := []int{1, 2, 3, 4, 5, 6}
	evens := Filter(nums, func(n int) bool { return n%2 == 0 })
	if len(evens) != 3 {
		t.Errorf("expected 3 evens, got %d", len(evens))
	}
	if evens[0] != 2 || evens[1] != 4 || evens[2] != 6 {
		t.Errorf("unexpected evens: %v", evens)
	}
}
