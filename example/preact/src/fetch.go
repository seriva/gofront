package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"js:./preact.d.ts"
)

// FetchCancel lets the caller stop an in-flight fetch, either by calling
// Cancel or by giving it a deadline.
type FetchCancel struct {
	cancelled  bool
	deadline   time.Time
	hasLimit   bool
	started    bool
	controller AbortControllerWrapper
}

// NewFetchCancel returns a FetchCancel that is not cancelled and has no deadline.
func NewFetchCancel() *FetchCancel {
	return &FetchCancel{}
}

// Cancel marks the fetch as cancelled and aborts the request if it has started.
func (c *FetchCancel) Cancel() {
	c.cancelled = true
	if c.started {
		c.controller.abort()
	}
}

// Err reports why the fetch should stop, or nil to keep going.
func (c *FetchCancel) Err() error {
	if c.cancelled {
		return errors.New("fetch canceled")
	}
	if c.hasLimit && !time.Now().Before(c.deadline) {
		return errors.New("fetch deadline exceeded")
	}
	return nil
}

// FetchTodosWithCancel fetches todos from url. Cancelling c, before or during
// the request, cancels the fetch through an AbortController.
async func FetchTodosWithCancel(c *FetchCancel, url string) (loaded []Todo, err error) {
	defer func() {
		if r := recover(); r != nil {
			err = errors.New(fmt.Sprintf("%v", r))
		}
	}()

	if stopErr := c.Err(); stopErr != nil {
		return nil, stopErr
	}

	c.controller = newAbortController()
	c.started = true

	resp := await fetch(url, map[string]any{"signal": c.controller.signal})
	if resp == nil {
		return nil, fmt.Errorf("fetch %s failed: nil response", url)
	}

	text := await resp.text()
	if unmarshalErr := json.Unmarshal([]byte(text), &loaded); unmarshalErr != nil {
		return nil, fmt.Errorf("failed to decode todos: %w", unmarshalErr)
	}
	return loaded, nil
}

// FetchTodosWithTimeout fetches todos and gives up if the deadline has passed
// by the time the request would start.
async func FetchTodosWithTimeout(url string, timeout time.Duration) ([]Todo, error) {
	c := NewFetchCancel()
	c.deadline = time.Now().Add(timeout)
	c.hasLimit = true
	items, err := await FetchTodosWithCancel(c, url)
	return items, err
}
