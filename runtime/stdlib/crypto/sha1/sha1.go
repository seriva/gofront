//go:build gofront

//gofront:target both

// Package sha1 implements the SHA-1 hash algorithm as defined in RFC 3174.
//
// SHA-1 is cryptographically broken. It is provided for checksums and
// compatibility only, and is not hardened against side-channel attacks.
package sha1

import (
	"hash"
)

// The size of a SHA-1 checksum in bytes.
const Size = 20

// The blocksize of SHA-1 in bytes.
const BlockSize = 64

// digest represents the partial evaluation of a checksum.
type digest struct {
	h   [5]uint32
	x   [64]byte
	nx  int
	len uint64
}

func (d *digest) Reset() {
	d.h[0] = 0x67452301
	d.h[1] = 0xEFCDAB89
	d.h[2] = 0x98BADCFE
	d.h[3] = 0x10325476
	d.h[4] = 0xC3D2E1F0
	d.nx = 0
	d.len = 0
}

// New returns a new hash.Hash computing the SHA1 checksum.
func New() hash.Hash {
	d := new(digest)
	d.Reset()
	return d
}

func (d *digest) Size() int { return Size }

func (d *digest) BlockSize() int { return BlockSize }

func (d *digest) Clone() (hash.Cloner, error) {
	r := *d
	return &r, nil
}

func (d *digest) Write(p []byte) (nn int, err error) {
	nn = len(p)
	d.len += uint64(nn)
	if d.nx > 0 {
		n := copy(d.x[d.nx:], p)
		d.nx += n
		if d.nx == BlockSize {
			block(d, d.x[:])
			d.nx = 0
		}
		p = p[n:]
	}
	if len(p) >= BlockSize {
		n := len(p) &^ (BlockSize - 1)
		block(d, p[:n])
		p = p[n:]
	}
	if len(p) > 0 {
		d.nx = copy(d.x[:], p)
	}
	return
}

func (d *digest) Sum(in []byte) []byte {
	// Make a copy of d so that caller can keep writing and summing.
	d0 := *d
	sum := d0.checkSum()
	return append(in, sum[:]...)
}

func (d *digest) checkSum() [20]byte {
	length := d.len
	var tmp [72]byte
	tmp[0] = 0x80
	pad := (55 - int(length%64) + 64) % 64
	n := 1 + pad
	bits := length << 3
	for i := 0; i < 8; i++ {
		tmp[n+i] = byte(bits >> (8 * uint(7-i)))
	}
	d.Write(tmp[:n+8])

	var out [20]byte
	for i := 0; i < 5; i++ {
		s := d.h[i]
		out[i*4] = byte(s >> 24)
		out[i*4+1] = byte(s >> 16)
		out[i*4+2] = byte(s >> 8)
		out[i*4+3] = byte(s)
	}
	return out
}

// Sum returns the SHA-1 checksum of the data.
func Sum(data []byte) [20]byte {
	var d digest
	d.Reset()
	d.Write(data)
	return d.checkSum()
}

func block(dig *digest, p []byte) {
	var w [80]uint32
	for len(p) >= BlockSize {
		for i := 0; i < 16; i++ {
			j := i * 4
			w[i] = uint32(p[j])<<24 | uint32(p[j+1])<<16 | uint32(p[j+2])<<8 | uint32(p[j+3])
		}
		for i := 16; i < 80; i++ {
			t := w[i-3] ^ w[i-8] ^ w[i-14] ^ w[i-16]
			w[i] = t<<1 | t>>31
		}
		a, b, c, d, e := dig.h[0], dig.h[1], dig.h[2], dig.h[3], dig.h[4]
		for i := 0; i < 80; i++ {
			var f, k uint32
			switch {
			case i < 20:
				f = b&c | (^b)&d
				k = 0x5A827999
			case i < 40:
				f = b ^ c ^ d
				k = 0x6ED9EBA1
			case i < 60:
				f = ((b | c) & d) | (b & c)
				k = 0x8F1BBCDC
			default:
				f = b ^ c ^ d
				k = 0xCA62C1D6
			}
			t := (a<<5 | a>>27) + f + e + w[i] + k
			a, b, c, d, e = t, a, (b<<30 | b>>2), c, d
		}
		dig.h[0] += a
		dig.h[1] += b
		dig.h[2] += c
		dig.h[3] += d
		dig.h[4] += e
		p = p[BlockSize:]
	}
}
