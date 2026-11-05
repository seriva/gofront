//go:build gofront

//gofront:target js

package time

// The timer half of the package needs the host's event loop, so it is only
// available to js packages.

//gofront:intrinsic time_sleep
async func hostSleep(ns int64)

// Sleep pauses the current function for at least the duration d. Callers
// must await it.
async func Sleep(d Duration) {
	await hostSleep(int64(d))
}

// The Timer type represents a single event. When the Timer expires, the
// function passed to AfterFunc is called in its own goroutine.
type Timer struct {
	id     any
	f      func()
	active bool
}

func (t *Timer) arm(d Duration) {
	t.active = true
	t.id = setTimeout(func() {
		t.active = false
		t.f()
	}, float64((d+Millisecond/2)/Millisecond))
}

// AfterFunc waits for the duration to elapse and then calls f. It returns a
// Timer that can be used to cancel the call using its Stop method.
func AfterFunc(d Duration, f func()) *Timer {
	t := &Timer{f: f}
	t.arm(d)
	return t
}

// Stop prevents the Timer from firing. It returns true if the call stops the
// timer, false if the timer has already expired or been stopped.
func (t *Timer) Stop() bool {
	was := t.active
	if was {
		clearTimeout(t.id)
		t.active = false
	}
	return was
}

// Reset changes the timer to expire after duration d. It returns true if the
// timer had been active, false if it had expired or been stopped.
func (t *Timer) Reset(d Duration) bool {
	was := t.active
	if was {
		clearTimeout(t.id)
	}
	t.arm(d)
	return was
}
