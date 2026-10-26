//go:build gofront

//gofront:target both

package context

import (
	"errors"
	"time"
)

// DeadlineExceeded is the error returned by Context.Err when the context's
// deadline passes.
var DeadlineExceeded = errors.New("context deadline exceeded")

//gofront:intrinsic deadline_timer
func armDeadline(ns int64, fire func())

// A timerCtx carries a timer and a deadline.
type timerCtx struct {
	cancel        *cancelCtx
	deadline      time.Time
	deadlineCause error
}

func (c *timerCtx) Deadline() (deadline time.Time, ok bool) {
	return c.deadline, true
}

func (c *timerCtx) Err() error {
	if c.cancel.err != nil {
		return c.cancel.err
	}
	if !time.Now().Before(c.deadline) {
		cause := c.deadlineCause
		if cause == nil {
			cause = DeadlineExceeded
		}
		c.cancel.cancel(true, DeadlineExceeded, cause)
		return c.cancel.err
	}
	return nil
}

func (c *timerCtx) Value(key any) any {
	return c.cancel.Value(key)
}

// WithDeadline returns a copy of the parent context with the deadline adjusted
// to be no later than d.
func WithDeadline(parent Context, d time.Time) (Context, CancelFunc) {
	c, cancel := WithDeadlineCause(parent, d, nil)
	return c, cancel
}

// WithDeadlineCause behaves like WithDeadline but also sets the cause of the
// returned Context when the deadline is exceeded.
func WithDeadlineCause(parent Context, d time.Time, cause error) (Context, CancelFunc) {
	if parent == nil {
		panic("cannot create context from nil parent")
	}
	if cur, ok := parent.Deadline(); ok && cur.Before(d) {
		ctx, cancel := WithCancelCause(parent)
		return ctx, func() { cancel(Canceled) }
	}
	cc := withCancel(parent)
	c := &timerCtx{
		cancel:        cc,
		deadline:      d,
		deadlineCause: cause,
	}
	dur := d.Sub(time.Now())
	if dur <= 0 {
		effCause := cause
		if effCause == nil {
			effCause = DeadlineExceeded
		}
		cc.cancel(true, DeadlineExceeded, effCause)
		return c, func() { cc.cancel(true, Canceled, nil) }
	}
	armDeadline(int64(dur), func() {
		effCause := cause
		if effCause == nil {
			effCause = DeadlineExceeded
		}
		cc.cancel(true, DeadlineExceeded, effCause)
	})
	return c, func() { cc.cancel(true, Canceled, nil) }
}

// WithTimeout returns WithDeadline(parent, time.Now().Add(timeout)).
func WithTimeout(parent Context, timeout time.Duration) (Context, CancelFunc) {
	c, cancel := WithDeadlineCause(parent, time.Now().Add(timeout), nil)
	return c, cancel
}

// WithTimeoutCause returns WithDeadlineCause(parent, time.Now().Add(timeout), cause).
func WithTimeoutCause(parent Context, timeout time.Duration, cause error) (Context, CancelFunc) {
	c, cancel := WithDeadlineCause(parent, time.Now().Add(timeout), cause)
	return c, cancel
}

type afterFunc struct {
	f    func()
	once bool
}

func (a *afterFunc) cancel(removeFromParent bool, err, cause error) {
	if a.once {
		return
	}
	a.once = true
	a.f()
}

// AfterFunc arranges to call f after ctx is canceled or times out.
// It returns a stop func that stops f from being called.
func AfterFunc(ctx Context, f func()) (stop func() bool) {
	a := &afterFunc{f: f}
	if ctx.Err() != nil {
		a.cancel(false, ctx.Err(), Cause(ctx))
		return func() bool { return false }
	}
	propagateCancel(ctx, a)
	return func() bool {
		if a.once {
			return false
		}
		a.once = true
		removeChild(ctx, a)
		return true
	}
}
