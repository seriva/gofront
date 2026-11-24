//go:build gofront

//gofront:target js

package gom

// Signals, computed values and effects: synchronous publisher-subscriber
// closures, with no scheduler and no diffing. A Set notifies everything that
// depends on the signal before it returns.
//
// How a Set runs: it first marks every Computed downstream of the signal stale
// and collects the Effects and Subscribe callbacks reached, then runs each of
// those once. Before running one, it brings the Computed values it reads up to
// date and skips it when none of them changed. So an effect that reads both a
// signal and a Computed derived from it runs once per Set, with both fresh,
// and an effect on a Computed whose result did not change does not run.

// maxEffectDepth bounds effects that Set a signal they read, directly or
// through each other.
const maxEffectDepth = 100

const loopMessage = "gom: effects keep triggering each other; does an Effect Set a signal it reads?"

// dep is the part of a Signal or Computed that observers subscribe to.
type dep struct {
	// version counts the changes of the value.
	version int
	subs    []*observer
	// owner is the Computed this dep belongs to; nil for a Signal.
	owner *observer
}

// An observer is an Effect, a Subscribe callback, or the evaluation of a
// Computed. Dependencies are the deps it read in its last run.
type observer struct {
	deps []*dep
	// seen holds the version of each dep when the observer last ran.
	seen []int
	fn   func()
	// tracks reports whether the observer records the deps it reads (Effect
	// and Computed) rather than being attached to one dep (Subscribe).
	tracks bool
	// own is the dep of the Computed this observer evaluates; nil otherwise.
	own *dep
	// stale marks a Computed that must be evaluated before its next read; it
	// stays set if the evaluation panics.
	stale    bool
	running  bool
	// again is set when the observer is triggered while it runs.
	again    bool
	disposed bool
	// queued is the publish round that last collected the observer.
	queued int
}

var (
	// current is the observer whose reads are being recorded, if any.
	current *observer
	// round numbers the publishes, so one is collected at most once per round.
	round int
	// depth is the number of observers running inside one another.
	depth int
)

// track records that the running observer read d.
func track(d *dep) {
	o := current
	if o == nil {
		return
	}
	for _, have := range o.deps {
		if have == d {
			return
		}
	}
	o.deps = append(o.deps, d)
	o.seen = append(o.seen, d.version)
	d.subs = append(d.subs, o)
}

// unsubscribe removes o from d. It copies the list, so a publish that is
// iterating the old one is not disturbed.
func unsubscribe(d *dep, o *observer) {
	kept := make([]*observer, 0, len(d.subs))
	for _, s := range d.subs {
		if s != o {
			kept = append(kept, s)
		}
	}
	d.subs = kept
}

// untrack drops every dependency of o.
func untrack(o *observer) {
	for _, d := range o.deps {
		unsubscribe(d, o)
	}
	o.deps = nil
	o.seen = nil
}

// dispose detaches o for good.
func dispose(o *observer) {
	o.disposed = true
	untrack(o)
}

// refresh brings the Computed that owns d up to date.
func refresh(d *dep) {
	if o := d.owner; o != nil && o.stale {
		evaluate(o)
	}
}

// evaluate runs the observer fn with its reads recorded. An Effect that is
// triggered while it runs (it Set a signal it read) runs again once it is done.
func evaluate(o *observer) {
	o.again = false
	for n := 0; ; n++ {
		if n >= maxEffectDepth {
			panic(loopMessage)
		}
		evaluateOnce(o)
		if !o.again {
			return
		}
		o.again = false
		if !changed(o) {
			return
		}
	}
}

func evaluateOnce(o *observer) {
	if o.running {
		panic("gom: a Computed or Effect depends on itself")
	}
	if depth >= maxEffectDepth {
		panic(loopMessage)
	}
	depth++
	prev := current
	o.running = true
	untrack(o)
	current = o
	defer func() {
		current = prev
		o.running = false
		depth--
	}()
	o.fn()
	o.stale = false
}

// collect gathers the effects and callbacks that depend on d, marking the
// Computed values on the way stale.
func collect(d *dep, found []*observer, r int) []*observer {
	for _, o := range d.subs {
		if o.disposed {
			continue
		}
		if o.own == nil {
			if o.queued != r {
				o.queued = r
				found = append(found, o)
			}
			continue
		}
		if o.stale {
			continue
		}
		o.stale = true
		if len(o.own.subs) == 0 {
			// Nobody watches it: stop listening until it is read again.
			untrack(o)
		} else {
			found = collect(o.own, found, r)
		}
	}
	return found
}

// changed reports whether any dependency of o changed since it last ran.
func changed(o *observer) bool {
	for i, d := range o.deps {
		refresh(d)
		if d.version != o.seen[i] {
			return true
		}
	}
	return false
}

// publish runs everything that depends on d, which just changed.
func publish(d *dep) {
	round++
	found := collect(d, nil, round)
	for _, o := range found {
		if o.disposed {
			continue
		}
		if o.running {
			o.again = true
			continue
		}
		if !changed(o) {
			continue
		}
		if o.tracks {
			evaluate(o)
		} else {
			callback(o)
		}
	}
}

// callback runs a Subscribe callback outside any recording.
func callback(o *observer) {
	for i, d := range o.deps {
		o.seen[i] = d.version
	}
	if depth >= maxEffectDepth {
		panic(loopMessage)
	}
	depth++
	prev := current
	current = nil
	defer func() {
		current = prev
		depth--
	}()
	o.fn()
}

// attach subscribes o, a Subscribe callback, to d.
func attach(o *observer, d *dep) func() {
	o.deps = []*dep{d}
	o.seen = []int{d.version}
	d.subs = append(d.subs, o)
	return func() { dispose(o) }
}

// A Signal holds a value and notifies its subscribers when it changes.
type Signal[T any] struct {
	val T
	d   dep
}

// NewSignal is a Signal that starts with v.
func NewSignal[T any](v T) *Signal[T] {
	return &Signal[T]{val: v}
}

// Get is the current value. Inside an Effect or Computed it also makes the
// signal one of its dependencies.
func (s *Signal[T]) Get() T {
	track(&s.d)
	return s.val
}

// Set replaces the value and runs everything that depends on the signal,
// unless the new value is the same as the old one (compared like
// Object.is: numbers and strings by value, slices, maps and structs by
// identity).
func (s *Signal[T]) Set(v T) {
	if Object.is(s.val, v) {
		return
	}
	s.val = v
	s.d.version++
	publish(&s.d)
}

// Subscribe calls fn with the new value after every change, and returns the
// function that stops it. fn is not called for the current value.
func (s *Signal[T]) Subscribe(fn func(T)) func() {
	o := &observer{}
	o.fn = func() { fn(s.val) }
	return attach(o, &s.d)
}

// A Computed is a value derived from signals. It is evaluated when first read,
// and again, when read, after something it read has changed. While an Effect,
// another Computed or a Subscribe callback watches it, it is evaluated as soon
// as a dependency changes and passes the change on only when its result is
// different.
type Computed[T any] struct {
	val T
	has bool
	o   *observer
	d   dep
}

// NewComputed is a Computed whose value is fn. fn must only read, not Set.
func NewComputed[T any](fn func() T) *Computed[T] {
	c := &Computed[T]{}
	c.o = &observer{tracks: true, stale: true, own: &c.d}
	c.d.owner = c.o
	c.o.fn = func() {
		v := fn()
		if !c.has || !Object.is(c.val, v) {
			c.val = v
			c.has = true
			c.d.version++
		}
	}
	return c
}

// Get is the current value, evaluating it first when a dependency changed.
// Inside an Effect or Computed it also makes this one of its dependencies.
func (c *Computed[T]) Get() T {
	refresh(&c.d)
	track(&c.d)
	return c.val
}

// Subscribe calls fn with the new value whenever the result changes, and
// returns the function that stops it.
func (c *Computed[T]) Subscribe(fn func(T)) func() {
	// Evaluating it now makes it listen to its dependencies.
	refresh(&c.d)
	o := &observer{}
	o.fn = func() { fn(c.val) }
	return attach(o, &c.d)
}

// Effect runs fn now and again whenever a signal or Computed it read changes.
// What it reads is recorded afresh on every run, so only the dependencies of
// the latest run count. It returns the function that stops it. An Effect
// created while a gom.Mount or gom.MountTo runs also stops when that element
// is mounted again.
func Effect(fn func()) func() {
	o := &observer{tracks: true, fn: fn}
	stop := func() { dispose(o) }
	addToMountScope(stop)
	evaluate(o)
	return stop
}
