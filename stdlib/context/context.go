//go:build gofront

//gofront:target both

// Package context carries a cancellation signal and request-scoped values
// across API boundaries.
//
// It is the part of the real package that needs no channels or goroutines:
// Background, TODO, WithCancel and WithValue. The Context interface has no
// Done method and there are no deadlines or timeouts; poll Err instead.
package context

import (
	"errors"
	"time"
)

// A Context carries a cancellation signal and values across API boundaries.
type Context interface {
	// Deadline returns the time when work done on behalf of this context
	// should be canceled. No context has a deadline, so ok is always false.
	Deadline() (deadline time.Time, ok bool)

	// Err returns nil while the context is live, and Canceled once it has
	// been canceled.
	Err() error

	// Value returns the value associated with key, or nil.
	Value(key any) any
}

// Canceled is the error returned by Context.Err when the context is canceled.
var Canceled = errors.New("context canceled")

// A CancelFunc tells an operation to abandon its work.
type CancelFunc func()

type emptyCtx struct {
	name string
}

func (*emptyCtx) Deadline() (deadline time.Time, ok bool) { return }
func (*emptyCtx) Err() error                              { return nil }
func (*emptyCtx) Value(key any) any                       { return nil }
func (e *emptyCtx) String() string                        { return e.name }

var (
	background = &emptyCtx{"context.Background"}
	todo       = &emptyCtx{"context.TODO"}
)

// Background returns a non-nil, empty Context. It is never canceled and has
// no values.
func Background() Context {
	return background
}

// TODO returns a non-nil, empty Context, for code that has not yet decided
// which Context to use.
func TODO() Context {
	return todo
}

type cancelCtx struct {
	parent   Context
	canceled bool
}

func (c *cancelCtx) Deadline() (deadline time.Time, ok bool) { return }

func (c *cancelCtx) Err() error {
	if c.canceled {
		return Canceled
	}
	return c.parent.Err()
}

func (c *cancelCtx) Value(key any) any { return c.parent.Value(key) }

// WithCancel returns a derived context that is canceled when the returned
// cancel function is called, or when the parent is canceled.
func WithCancel(parent Context) (ctx Context, cancel CancelFunc) {
	if parent == nil {
		panic("cannot create context from nil parent")
	}
	c := &cancelCtx{parent: parent}
	return c, func() { c.canceled = true }
}

type valueCtx struct {
	Context
	key, val any
}

func (c *valueCtx) Value(key any) any {
	if c.key == key {
		return c.val
	}
	return c.Context.Value(key)
}

// WithValue returns a derived context in which key is associated with val.
func WithValue(parent Context, key, val any) Context {
	if parent == nil {
		panic("cannot create context from nil parent")
	}
	if key == nil {
		panic("nil key")
	}
	return &valueCtx{parent, key, val}
}
