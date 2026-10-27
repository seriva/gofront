//go:build gofront

//gofront:target both

// Overlay on the emitter-backed slices package: comparison and repetition
// members written in Go and merged into the slices namespace.  The
// checker has no core types for type parameters, so these take []E rather
// than Go's S ~[]E and Repeat returns []E.
package slices

// EqualFunc reports whether two slices are equal using an equality
// function on each pair of elements. If the lengths are different,
// EqualFunc returns false. Otherwise, the elements are compared in
// increasing index order, and the comparison stops at the first index
// for which eq returns false.
func EqualFunc[E1, E2 any](s1 []E1, s2 []E2, eq func(E1, E2) bool) bool {
	if len(s1) != len(s2) {
		return false
	}
	for i, v1 := range s1 {
		v2 := s2[i]
		if !eq(v1, v2) {
			return false
		}
	}
	return true
}

// CompareFunc is like Compare but uses a custom comparison function on each
// pair of elements.
// The result is the first non-zero result of cmp; if cmp always
// returns 0 the result is 0 if len(s1) == len(s2), -1 if len(s1) < len(s2),
// and +1 if len(s1) > len(s2).
func CompareFunc[E1, E2 any](s1 []E1, s2 []E2, cmp func(E1, E2) int) int {
	for i, v1 := range s1 {
		if i >= len(s2) {
			return +1
		}
		v2 := s2[i]
		if c := cmp(v1, v2); c != 0 {
			return c
		}
	}
	if len(s1) < len(s2) {
		return -1
	}
	return 0
}

// repeatMaxInt is the largest int, as the overflow bound of Repeat.
const repeatMaxInt = 1<<63 - 1

// Repeat returns a new slice that repeats the provided slice the given number of times.
// The result has length and capacity (len(x) * count).
// The result is never nil.
// Repeat panics if count is negative or if the result of (len(x) * count)
// overflows.
func Repeat[E any](x []E, count int) []E {
	if count < 0 {
		panic("cannot be negative")
	}

	if len(x) > 0 && count > repeatMaxInt/len(x) {
		panic("the result of (len(x) * count) overflows")
	}

	newslice := make([]E, len(x)*count)
	n := copy(newslice, x)
	for n < len(newslice) {
		n += copy(newslice[n:], newslice[:n])
	}
	return newslice
}
