package utils

import "testing"

func TestPlural(t *testing.T) {
	if Plural(1, "task") != "1 task" {
		t.Errorf("expected '1 task', got %q", Plural(1, "task"))
	}
	if Plural(4, "task") != "4 tasks" {
		t.Errorf("expected '4 tasks', got %q", Plural(4, "task"))
	}
}

func TestHasText(t *testing.T) {
	if !HasText("valid") {
		t.Error("expected true for 'valid'")
	}
	if HasText("   \t\n") {
		t.Error("expected false for whitespace")
	}
}

func TestFilter(t *testing.T) {
	words := []string{"apple", "banana", "avocado", "cherry"}
	aWords := Filter(words, func(w string) bool { return strings.HasPrefix(w, "a") })
	if len(aWords) != 2 {
		t.Fatalf("expected 2 words, got %d", len(aWords))
	}
	if aWords[0] != "apple" || aWords[1] != "avocado" {
		t.Errorf("unexpected filtered words: %v", aWords)
	}
}
