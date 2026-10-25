//go:build gofront

//gofront:target both

// Package hash provides interfaces for hash functions.
package hash

import "io"

// Hash is the common interface implemented by all hash functions.
type Hash interface {
	io.Writer

	// Sum appends the current hash to b and returns the resulting slice.
	// It does not change the underlying hash state.
	Sum(b []byte) []byte

	// Reset resets the Hash to its initial state.
	Reset()

	// Size returns the number of bytes Sum will return.
	Size() int

	// BlockSize returns the hash's underlying block size.
	BlockSize() int
}

// Hash32 is the common interface implemented by all 32-bit hash functions.
type Hash32 interface {
	Hash
	Sum32() uint32
}

// Hash64 is the common interface implemented by all 64-bit hash functions.
type Hash64 interface {
	Hash
	Sum64() uint64
}

// A Cloner is a hash function whose state can be cloned, returning a value with
// equivalent and independent state.
type Cloner interface {
	Hash
	Clone() (Cloner, error)
}

// XOF (extendable output function) is a hash function with arbitrary or unlimited output length.
type XOF interface {
	io.Writer
	Read(p []byte) (n int, err error)
	Reset()
	BlockSize() int
}
