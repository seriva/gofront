package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"js:./preact.d.ts"
)

// FetchTodosWithContext fetches todos from url using an AbortController bridged
// to ctx via context.AfterFunc so that cancelling the context cancels the in-flight fetch.
async func FetchTodosWithContext(ctx context.Context, url string) (loaded []Todo, err error) {
	defer func() {
		if r := recover(); r != nil {
			err = errors.New(fmt.Sprintf("%v", r))
		}
	}()

	if ctxErr := ctx.Err(); ctxErr != nil {
		return nil, ctxErr
	}

	controller := newAbortController()
	stop := context.AfterFunc(ctx, func() {
		controller.abort()
	})
	defer stop()

	resp := await fetch(url, map[string]any{"signal": controller.signal})
	if resp == nil {
		return nil, fmt.Errorf("fetch %s failed: nil response", url)
	}

	text := await resp.text()
	if unmarshalErr := json.Unmarshal([]byte(text), &loaded); unmarshalErr != nil {
		return nil, fmt.Errorf("failed to decode todos: %w", unmarshalErr)
	}
	return loaded, nil
}

// FetchTodosWithTimeout fetches todos with a timeout context.
async func FetchTodosWithTimeout(url string, timeout time.Duration) ([]Todo, error) {
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()
	items, err := await FetchTodosWithContext(ctx, url)
	return items, err
}
