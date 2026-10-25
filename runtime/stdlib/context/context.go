//go:build gofront

//gofront:target both

package context

import (
	"errors"
	"time"
)

// Canceled is the error returned by Context.Err when the context is canceled.
var Canceled = errors.New("context canceled")

// A CancelFunc tells an operation to abandon its work.
type CancelFunc func()

// A CancelCauseFunc behaves like a CancelFunc but additionally sets the cancellation cause.
type CancelCauseFunc func(cause error)

// A Context carries a deadline, a cancellation signal, and other values across
// API boundaries.
type Context interface {
	Deadline() (deadline time.Time, ok bool)
	Err() error
	Value(key any) any
}

type emptyCtx int

func (emptyCtx) Deadline() (deadline time.Time, ok bool) {
	return time.Time{}, false
}

func (emptyCtx) Err() error {
	return nil
}

func (emptyCtx) Value(key any) any {
	return nil
}

func (e emptyCtx) String() string {
	switch e {
	case 1:
		return "context.Background"
	case 2:
		return "context.TODO"
	}
	return "unknown empty Context"
}

var (
	background = emptyCtx(1)
	todo       = emptyCtx(2)
)

// Background returns a non-nil, empty Context. It is never canceled, has no
// values, and has no deadline.
func Background() Context {
	return background
}

// TODO returns a non-nil, empty Context. Code should use context.TODO when
// it's unclear which Context to use or it is not yet available.
func TODO() Context {
	return todo
}

type cancelKey int

var cancelsKey cancelKey = 0

type canceler interface {
	cancel(removeFromParent bool, err, cause error)
}

// A cancelCtx can be canceled. When canceled, it also cancels any children
// that implement canceler.
type cancelCtx struct {
	parent   Context
	err      error
	cause    error
	children []canceler
}

func (c *cancelCtx) Deadline() (deadline time.Time, ok bool) {
	if c.parent == nil {
		return time.Time{}, false
	}
	d, ok := c.parent.Deadline()
	return d, ok
}

func (c *cancelCtx) Err() error {
	return c.err
}

func (c *cancelCtx) Value(key any) any {
	if key == cancelsKey {
		return c
	}
	if c.parent == nil {
		return nil
	}
	return c.parent.Value(key)
}

func (c *cancelCtx) cancel(removeFromParent bool, err, cause error) {
	if err == nil {
		panic("context: internal error: missing cancel error")
	}
	if c.err != nil {
		return // already canceled
	}
	c.err = err
	c.cause = cause
	for _, child := range c.children {
		child.cancel(false, err, cause)
	}
	c.children = nil
	if removeFromParent {
		removeChild(c.parent, c)
	}
}

func parentCancelCtx(parent Context) (*cancelCtx, bool) {
	if parent == nil {
		return nil, false
	}
	v := parent.Value(cancelsKey)
	if v == nil {
		return nil, false
	}
	c, ok := v.(*cancelCtx)
	return c, ok
}

func propagateCancel(parent Context, child canceler) {
	if parent.Err() != nil {
		child.cancel(false, parent.Err(), Cause(parent))
		return
	}
	p, ok := parentCancelCtx(parent)
	if !ok {
		return
	}
	if p.err != nil {
		child.cancel(false, p.err, p.cause)
		return
	}
	p.children = append(p.children, child)
}

func removeChild(parent Context, child canceler) {
	p, ok := parentCancelCtx(parent)
	if !ok {
		return
	}
	for i, ch := range p.children {
		if ch == child {
			p.children = append(p.children[:i], p.children[i+1:]...)
			break
		}
	}
}

// WithCancel returns a copy of parent with a new Done channel. The returned
// context's Done channel is closed when the returned cancel function is called
// or when the parent context's Done channel is closed, whichever happens first.
func WithCancel(parent Context) (ctx Context, cancel CancelFunc) {
	c := withCancel(parent)
	return c, func() { c.cancel(true, Canceled, nil) }
}

// WithCancelCause behaves like WithCancel but returns a CancelCauseFunc instead of a CancelFunc.
func WithCancelCause(parent Context) (ctx Context, cancel CancelCauseFunc) {
	c := withCancel(parent)
	return c, func(cause error) { c.cancel(true, Canceled, cause) }
}

func withCancel(parent Context) *cancelCtx {
	if parent == nil {
		panic("cannot create context from nil parent")
	}
	c := &cancelCtx{parent: parent}
	propagateCancel(parent, c)
	return c
}

// Cause returns a non-nil error explaining why c was canceled.
func Cause(c Context) error {
	if c == nil || c.Err() == nil {
		return nil
	}
	v := c.Value(cancelsKey)
	if v != nil {
		if cc, ok := v.(*cancelCtx); ok && cc.cause != nil {
			return cc.cause
		}
	}
	return c.Err()
}

// WithoutCancel returns a copy of parent that is not canceled when parent is canceled.
func WithoutCancel(parent Context) Context {
	if parent == nil {
		panic("cannot create context from nil parent")
	}
	return withoutCancelCtx{parent: parent}
}

type withoutCancelCtx struct {
	parent Context
}

func (w withoutCancelCtx) Deadline() (deadline time.Time, ok bool) {
	return time.Time{}, false
}

func (w withoutCancelCtx) Err() error {
	return nil
}

func (w withoutCancelCtx) Value(key any) any {
	if key == cancelsKey {
		return nil
	}
	if w.parent == nil {
		return nil
	}
	return w.parent.Value(key)
}

type valueCtx struct {
	parent Context
	key    any
	val    any
}

// WithValue returns a copy of parent in which the value associated with key is val.
func WithValue(parent Context, key, val any) Context {
	if parent == nil {
		panic("cannot create context from nil parent")
	}
	if key == nil {
		panic("nil key")
	}
	return &valueCtx{parent: parent, key: key, val: val}
}

func (c *valueCtx) Deadline() (deadline time.Time, ok bool) {
	if c.parent == nil {
		return time.Time{}, false
	}
	d, ok := c.parent.Deadline()
	return d, ok
}

func (c *valueCtx) Err() error {
	if c.parent == nil {
		return nil
	}
	return c.parent.Err()
}

func (c *valueCtx) Value(key any) any {
	if c.key == key {
		return c.val
	}
	if c.parent == nil {
		return nil
	}
	return c.parent.Value(key)
}
