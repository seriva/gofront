//go:build gofront

//gofront:target both

// Package iter provides basic definitions related to iterators over
// sequences. Same API as Go's iter package; Pull and Pull2 need coroutines
// and are not available.
package iter

// Seq is an iterator over sequences of individual values. When called as
// seq(yield), seq calls yield(v) for each value v in the sequence, stopping
// early if yield returns false.
type Seq[V any] func(yield func(V) bool)

// Seq2 is an iterator over sequences of pairs of values, most commonly
// key-value pairs. When called as seq(yield), seq calls yield(k, v) for each
// pair (k, v) in the sequence, stopping early if yield returns false.
type Seq2[K, V any] func(yield func(K, V) bool)
