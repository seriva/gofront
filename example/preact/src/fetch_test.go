package main

import (
	"testing"
)

async func TestFetchWithCancelledFetch(t *testing.T) {
	c := NewFetchCancel()
	c.Cancel() // cancel immediately

	// A pre-cancelled fetch should report an error without starting the request
	_, err := await FetchTodosWithCancel(c, "http://localhost:3002/todos.json")
	if err == nil {
		t.Error("expected error with pre-cancelled fetch, got nil")
	}
}

async func TestFetchTimeoutCancellation(t *testing.T) {
	// A timeout of 0 has already expired when the request would start
	_, err := await FetchTodosWithTimeout("http://localhost:3002/todos.json", 0)
	if err == nil {
		t.Error("expected error with expired timeout, got nil")
	}
}
