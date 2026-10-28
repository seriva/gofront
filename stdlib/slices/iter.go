//go:build gofront

//gofront:target both

// Overlay on the emitter-backed slices package: the iterator members are
// written in Go over iter.Seq and iter.Seq2 and merged into the slices
// namespace. Unqualified references to emitter members (Sort, SortFunc,
// SortStableFunc) resolve to the emitter implementation.
package slices

import (
	"cmp"
	"iter"
)

// All returns an iterator over index-value pairs in the slice
// in the usual order.
func All[E any](s []E) iter.Seq2[int, E] {
	return func(yield func(int, E) bool) {
		for i, v := range s {
			if !yield(i, v) {
				return
			}
		}
	}
}

// Backward returns an iterator over index-value pairs in the slice,
// traversing it backward with descending indices.
func Backward[E any](s []E) iter.Seq2[int, E] {
	return func(yield func(int, E) bool) {
		for i := len(s) - 1; i >= 0; i-- {
			if !yield(i, s[i]) {
				return
			}
		}
	}
}

// Values returns an iterator that yields the slice elements in order.
func Values[E any](s []E) iter.Seq[E] {
	return func(yield func(E) bool) {
		for _, v := range s {
			if !yield(v) {
				return
			}
		}
	}
}

// AppendSeq appends the values from seq to the slice and
// returns the extended slice.
func AppendSeq[E any](s []E, seq iter.Seq[E]) []E {
	for v := range seq {
		s = append(s, v)
	}
	return s
}

// Collect collects values from seq into a new slice and returns it.
func Collect[E any](seq iter.Seq[E]) []E {
	var s []E
	return AppendSeq(s, seq)
}

// Sorted collects values from seq into a new slice, sorts the slice,
// and returns it.
func Sorted[E cmp.Ordered](seq iter.Seq[E]) []E {
	s := Collect(seq)
	Sort(s)
	return s
}

// SortedFunc collects values from seq into a new slice, sorts the slice
// using the comparison function, and returns it.
func SortedFunc[E any](seq iter.Seq[E], cmp func(E, E) int) []E {
	s := Collect(seq)
	SortFunc(s, cmp)
	return s
}

// SortedStableFunc collects values from seq into a new slice.
// It then sorts the slice while keeping the original order of equal elements,
// using the comparison function to compare elements.
// It returns the new slice.
func SortedStableFunc[E any](seq iter.Seq[E], cmp func(E, E) int) []E {
	s := Collect(seq)
	SortStableFunc(s, cmp)
	return s
}

// Chunk returns an iterator over consecutive sub-slices of up to n elements
// of s. All but the last sub-slice will have size n. All sub-slices are
// clipped to have no capacity beyond the length. If s is empty, the sequence
// is empty: there is no empty slice in the sequence. Chunk panics if n is
// less than 1.
func Chunk[E any](s []E, n int) iter.Seq[[]E] {
	if n < 1 {
		panic("cannot be less than 1")
	}
	return func(yield func([]E) bool) {
		for i := 0; i < len(s); i += n {
			// Clamp the last chunk to the slice bound as necessary.
			end := min(n, len(s[i:]))

			// Set the capacity of each chunk so that appending to a chunk does
			// not modify the original slice.
			if !yield(s[i : i+end : i+end]) {
				return
			}
		}
	}
}
