//go:build gofront

//gofront:target both

// Package rand implements a cryptographically secure random number
// generator over the host's secure source (crypto.getRandomValues).
package rand

import "io"

// hostU32 returns four random bytes from the host's secure source.
//
//gofront:intrinsic crypto_rand_u32
func hostU32() uint32

type reader struct{}

func (reader) Read(b []byte) (int, error) { return Read(b) }

// Reader is a global, shared instance of a cryptographically secure random
// number generator.
var Reader io.Reader = reader{}

// Read fills b with cryptographically secure random bytes. It never returns
// an error, and always fills b entirely.
func Read(b []byte) (n int, err error) {
	for i := 0; i < len(b); i += 4 {
		v := hostU32()
		for j := 0; j < 4 && i+j < len(b); j++ {
			b[i+j] = byte(v >> (8 * j))
		}
	}
	return len(b), nil
}
