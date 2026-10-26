package main

import (
	"context"
	"testing"
)

async func TestFetchWithCancelledContext(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel() // cancel immediately

	// A pre-cancelled context should report context.Canceled error
	_, err := await FetchTodosWithContext(ctx, "http://localhost:3002/todos.json")
	if err == nil {
		t.Error("expected error with pre-cancelled context, got nil")
	}
}

async func TestFetchTimeoutCancellation(t *testing.T) {
	// A timeout of 1ns expires immediately
	_, err := await FetchTodosWithTimeout("http://localhost:3002/todos.json", 1)
	if err == nil {
		t.Error("expected error with expired timeout context, got nil")
	}
}
