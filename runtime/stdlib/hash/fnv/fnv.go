//go:build gofront

//gofront:target both

// Package fnv implements FNV-1 and FNV-1a, non-cryptographic hash functions
// created by Glenn Fowler, Landon Curt Noll, and Phong Vo.
package fnv

import (
	"hash"
	"math/bits"
)

type (
	sum32   uint32
	sum32a  uint32
	sum64   uint64
	sum64a  uint64
	sum128  [2]uint64
	sum128a [2]uint64
)

const (
	offset32        = 2166136261
	offset64        = 14695981039346656037
	offset128Lower  = 0x62b821756295c58d
	offset128Higher = 0x6c62272e07bb0142
	prime32         = 16777619
	prime64         = 1099511628211
	prime128Lower   = 0x13b
	prime128Shift   = 24
)

// New32 returns a new 32-bit FNV-1 [hash.Hash].
func New32() hash.Hash32 {
	var s sum32 = offset32
	return &s
}

// New32a returns a new 32-bit FNV-1a [hash.Hash].
func New32a() hash.Hash32 {
	var s sum32a = offset32
	return &s
}

// New64 returns a new 64-bit FNV-1 [hash.Hash].
func New64() hash.Hash64 {
	var s sum64 = offset64
	return &s
}

// New64a returns a new 64-bit FNV-1a [hash.Hash].
func New64a() hash.Hash64 {
	var s sum64a = offset64
	return &s
}

// New128 returns a new 128-bit FNV-1 [hash.Hash].
func New128() hash.Hash {
	var s sum128
	s[0] = offset128Higher
	s[1] = offset128Lower
	return &s
}

// New128a returns a new 128-bit FNV-1a [hash.Hash].
func New128a() hash.Hash {
	var s sum128a
	s[0] = offset128Higher
	s[1] = offset128Lower
	return &s
}

func (s *sum32) Reset()   { *s = offset32 }
func (s *sum32a) Reset()  { *s = offset32 }
func (s *sum64) Reset()   { *s = offset64 }
func (s *sum64a) Reset()  { *s = offset64 }
func (s *sum128) Reset()  { s[0] = offset128Higher; s[1] = offset128Lower }
func (s *sum128a) Reset() { s[0] = offset128Higher; s[1] = offset128Lower }

func (s *sum32) Sum32() uint32  { return uint32(*s) }
func (s *sum32a) Sum32() uint32 { return uint32(*s) }
func (s *sum64) Sum64() uint64  { return uint64(*s) }
func (s *sum64a) Sum64() uint64 { return uint64(*s) }

func (s *sum32) Write(data []byte) (int, error) {
	h := *s
	for _, c := range data {
		h *= prime32
		h ^= sum32(c)
	}
	*s = h
	return len(data), nil
}

func (s *sum32a) Write(data []byte) (int, error) {
	h := *s
	for _, c := range data {
		h ^= sum32a(c)
		h *= prime32
	}
	*s = h
	return len(data), nil
}

func (s *sum64) Write(data []byte) (int, error) {
	h := *s
	for _, c := range data {
		h *= prime64
		h ^= sum64(c)
	}
	*s = h
	return len(data), nil
}

func (s *sum64a) Write(data []byte) (int, error) {
	h := *s
	for _, c := range data {
		h ^= sum64a(c)
		h *= prime64
	}
	*s = h
	return len(data), nil
}

func (s *sum128) Write(data []byte) (int, error) {
	for _, c := range data {
		s0, s1 := bits.Mul64(prime128Lower, s[1])
		s0 += s[1]<<prime128Shift + prime128Lower*s[0]
		s[1] = s1
		s[0] = s0
		s[1] ^= uint64(c)
	}
	return len(data), nil
}

func (s *sum128a) Write(data []byte) (int, error) {
	for _, c := range data {
		s[1] ^= uint64(c)
		s0, s1 := bits.Mul64(prime128Lower, s[1])
		s0 += s[1]<<prime128Shift + prime128Lower*s[0]
		s[1] = s1
		s[0] = s0
	}
	return len(data), nil
}

func (s *sum32) Size() int   { return 4 }
func (s *sum32a) Size() int  { return 4 }
func (s *sum64) Size() int   { return 8 }
func (s *sum64a) Size() int  { return 8 }
func (s *sum128) Size() int  { return 16 }
func (s *sum128a) Size() int { return 16 }

func (s *sum32) BlockSize() int   { return 1 }
func (s *sum32a) BlockSize() int  { return 1 }
func (s *sum64) BlockSize() int   { return 1 }
func (s *sum64a) BlockSize() int  { return 1 }
func (s *sum128) BlockSize() int  { return 1 }
func (s *sum128a) BlockSize() int { return 1 }

func appendUint32(b []byte, x uint32) []byte {
	return append(b, byte(x>>24), byte(x>>16), byte(x>>8), byte(x))
}

func appendUint64(b []byte, x uint64) []byte {
	return append(b,
		byte(x>>56), byte(x>>48), byte(x>>40), byte(x>>32),
		byte(x>>24), byte(x>>16), byte(x>>8), byte(x),
	)
}

func (s *sum32) Sum(in []byte) []byte {
	return appendUint32(in, uint32(*s))
}

func (s *sum32a) Sum(in []byte) []byte {
	return appendUint32(in, uint32(*s))
}

func (s *sum64) Sum(in []byte) []byte {
	return appendUint64(in, uint64(*s))
}

func (s *sum64a) Sum(in []byte) []byte {
	return appendUint64(in, uint64(*s))
}

func (s *sum128) Sum(in []byte) []byte {
	ret := appendUint64(in, s[0])
	return appendUint64(ret, s[1])
}

func (s *sum128a) Sum(in []byte) []byte {
	ret := appendUint64(in, s[0])
	return appendUint64(ret, s[1])
}

func (s *sum32) Clone() (hash.Cloner, error) {
	r := *s
	return &r, nil
}

func (s *sum32a) Clone() (hash.Cloner, error) {
	r := *s
	return &r, nil
}

func (s *sum64) Clone() (hash.Cloner, error) {
	r := *s
	return &r, nil
}

func (s *sum64a) Clone() (hash.Cloner, error) {
	r := *s
	return &r, nil
}

func (s *sum128) Clone() (hash.Cloner, error) {
	r := *s
	return &r, nil
}

func (s *sum128a) Clone() (hash.Cloner, error) {
	r := *s
	return &r, nil
}
