//go:build gofront

//gofront:target both

// Package md5 implements the MD5 hash algorithm as defined in RFC 1321.
//
// MD5 is cryptographically broken. It is provided for checksums and
// compatibility only, and is not hardened against side-channel attacks.
package md5

import (
	"hash"
)

// The size of an MD5 checksum in bytes.
const Size = 16

// The blocksize of MD5 in bytes.
const BlockSize = 64

var shifts = [64]uint32{
	7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
	5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
	4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
	6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
}

var table = [64]uint32{
	0xd76aa478, 0xe8c7b756, 0x242070db, 0xc1bdceee,
	0xf57c0faf, 0x4787c62a, 0xa8304613, 0xfd469501,
	0x698098d8, 0x8b44f7af, 0xffff5bb1, 0x895cd7be,
	0x6b901122, 0xfd987193, 0xa679438e, 0x49b40821,
	0xf61e2562, 0xc040b340, 0x265e5a51, 0xe9b6c7aa,
	0xd62f105d, 0x02441453, 0xd8a1e681, 0xe7d3fbc8,
	0x21e1cde6, 0xc33707d6, 0xf4d50d87, 0x455a14ed,
	0xa9e3e905, 0xfcefa3f8, 0x676f02d9, 0x8d2a4c8a,
	0xfffa3942, 0x8771f681, 0x6d9d6122, 0xfde5380c,
	0xa4beea44, 0x4bdecfa9, 0xf6bb4b60, 0xbebfbc70,
	0x289b7ec6, 0xeaa127fa, 0xd4ef3085, 0x04881d05,
	0xd9d4d039, 0xe6db99e5, 0x1fa27cf8, 0xc4ac5665,
	0xf4292244, 0x432aff97, 0xab9423a7, 0xfc93a039,
	0x655b59c3, 0x8f0ccc92, 0xffeff47d, 0x85845dd1,
	0x6fa87e4f, 0xfe2ce6e0, 0xa3014314, 0x4e0811a1,
	0xf7537e82, 0xbd3af235, 0x2ad7d2bb, 0xeb86d391,
}

// digest represents the partial evaluation of a checksum.
type digest struct {
	s   [4]uint32
	x   [64]byte
	nx  int
	len uint64
}

func (d *digest) Reset() {
	d.s[0] = 0x67452301
	d.s[1] = 0xefcdab89
	d.s[2] = 0x98badcfe
	d.s[3] = 0x10325476
	d.nx = 0
	d.len = 0
}

// New returns a new hash.Hash computing the MD5 checksum.
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

func (d *digest) checkSum() [16]byte {
	// Append 0x80, zero padding, then the length in bits (little endian).
	length := d.len
	var tmp [72]byte
	tmp[0] = 0x80
	pad := (55 - int(length%64) + 64) % 64
	n := 1 + pad
	bits := length << 3
	for i := 0; i < 8; i++ {
		tmp[n+i] = byte(bits >> (8 * uint(i)))
	}
	d.Write(tmp[:n+8])

	var out [16]byte
	for i := 0; i < 4; i++ {
		s := d.s[i]
		out[i*4] = byte(s)
		out[i*4+1] = byte(s >> 8)
		out[i*4+2] = byte(s >> 16)
		out[i*4+3] = byte(s >> 24)
	}
	return out
}

// Sum returns the MD5 checksum of the data.
func Sum(data []byte) [16]byte {
	var d digest
	d.Reset()
	d.Write(data)
	return d.checkSum()
}

func block(dig *digest, p []byte) {
	var m [16]uint32
	for len(p) >= BlockSize {
		for i := 0; i < 16; i++ {
			j := i * 4
			m[i] = uint32(p[j]) | uint32(p[j+1])<<8 | uint32(p[j+2])<<16 | uint32(p[j+3])<<24
		}
		a, b, c, d := dig.s[0], dig.s[1], dig.s[2], dig.s[3]
		for i := 0; i < 64; i++ {
			var f uint32
			var g int
			switch {
			case i < 16:
				f = (b & c) | (^b & d)
				g = i
			case i < 32:
				f = (d & b) | (^d & c)
				g = (5*i + 1) % 16
			case i < 48:
				f = b ^ c ^ d
				g = (3*i + 5) % 16
			default:
				f = c ^ (b | ^d)
				g = (7 * i) % 16
			}
			f = f + a + table[i] + m[g]
			a = d
			d = c
			c = b
			s := shifts[i]
			b = b + (f<<s | f>>(32-s))
		}
		dig.s[0] += a
		dig.s[1] += b
		dig.s[2] += c
		dig.s[3] += d
		p = p[BlockSize:]
	}
}
