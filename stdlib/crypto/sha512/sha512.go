//go:build gofront

//gofront:target both

// Package sha512 implements the SHA-384, SHA-512, SHA-512/224, and SHA-512/256
// hash algorithms as defined in FIPS 180-4.
//
// The state is kept as pairs of uint32 limbs (high word first) so the same
// source gives identical results on the JavaScript and WebAssembly backends.
// JavaScript numbers cannot hold a full uint64, so doing this with uint64
// arithmetic would be inexact there. The limb arithmetic is also slower than
// native 64-bit math: prefer WebAssembly or Web Crypto for large inputs.
//
// These hashes are meant for checksums, cache keys and HMAC verification.
// They are not hardened against side-channel attacks.
package sha512

import (
	"hash"
)

const (
	// Size is the size, in bytes, of a SHA-512 checksum.
	Size = 64
	// Size224 is the size, in bytes, of a SHA-512/224 checksum.
	Size224 = 28
	// Size256 is the size, in bytes, of a SHA-512/256 checksum.
	Size256 = 32
	// Size384 is the size, in bytes, of a SHA-384 checksum.
	Size384 = 48
	// BlockSize is the block size, in bytes, of the SHA-512 family.
	BlockSize = 128
)

var k512 = [160]uint32{
	0x428a2f98, 0xd728ae22, 0x71374491, 0x23ef65cd,
	0xb5c0fbcf, 0xec4d3b2f, 0xe9b5dba5, 0x8189dbbc,
	0x3956c25b, 0xf348b538, 0x59f111f1, 0xb605d019,
	0x923f82a4, 0xaf194f9b, 0xab1c5ed5, 0xda6d8118,
	0xd807aa98, 0xa3030242, 0x12835b01, 0x45706fbe,
	0x243185be, 0x4ee4b28c, 0x550c7dc3, 0xd5ffb4e2,
	0x72be5d74, 0xf27b896f, 0x80deb1fe, 0x3b1696b1,
	0x9bdc06a7, 0x25c71235, 0xc19bf174, 0xcf692694,
	0xe49b69c1, 0x9ef14ad2, 0xefbe4786, 0x384f25e3,
	0x0fc19dc6, 0x8b8cd5b5, 0x240ca1cc, 0x77ac9c65,
	0x2de92c6f, 0x592b0275, 0x4a7484aa, 0x6ea6e483,
	0x5cb0a9dc, 0xbd41fbd4, 0x76f988da, 0x831153b5,
	0x983e5152, 0xee66dfab, 0xa831c66d, 0x2db43210,
	0xb00327c8, 0x98fb213f, 0xbf597fc7, 0xbeef0ee4,
	0xc6e00bf3, 0x3da88fc2, 0xd5a79147, 0x930aa725,
	0x06ca6351, 0xe003826f, 0x14292967, 0x0a0e6e70,
	0x27b70a85, 0x46d22ffc, 0x2e1b2138, 0x5c26c926,
	0x4d2c6dfc, 0x5ac42aed, 0x53380d13, 0x9d95b3df,
	0x650a7354, 0x8baf63de, 0x766a0abb, 0x3c77b2a8,
	0x81c2c92e, 0x47edaee6, 0x92722c85, 0x1482353b,
	0xa2bfe8a1, 0x4cf10364, 0xa81a664b, 0xbc423001,
	0xc24b8b70, 0xd0f89791, 0xc76c51a3, 0x0654be30,
	0xd192e819, 0xd6ef5218, 0xd6990624, 0x5565a910,
	0xf40e3585, 0x5771202a, 0x106aa070, 0x32bbd1b8,
	0x19a4c116, 0xb8d2d0c8, 0x1e376c08, 0x5141ab53,
	0x2748774c, 0xdf8eeb99, 0x34b0bcb5, 0xe19b48a8,
	0x391c0cb3, 0xc5c95a63, 0x4ed8aa4a, 0xe3418acb,
	0x5b9cca4f, 0x7763e373, 0x682e6ff3, 0xd6b2b8a3,
	0x748f82ee, 0x5defb2fc, 0x78a5636f, 0x43172f60,
	0x84c87814, 0xa1f0ab72, 0x8cc70208, 0x1a6439ec,
	0x90befffa, 0x23631e28, 0xa4506ceb, 0xde82bde9,
	0xbef9a3f7, 0xb2c67915, 0xc67178f2, 0xe372532b,
	0xca273ece, 0xea26619c, 0xd186b8c7, 0x21c0c207,
	0xeada7dd6, 0xcde0eb1e, 0xf57d4f7f, 0xee6ed178,
	0x06f067aa, 0x72176fba, 0x0a637dc5, 0xa2c898a6,
	0x113f9804, 0xbef90dae, 0x1b710b35, 0x131c471b,
	0x28db77f5, 0x23047d84, 0x32caab7b, 0x40c72493,
	0x3c9ebe0a, 0x15c9bebc, 0x431d67c4, 0x9c100d4c,
	0x4cc5d4be, 0xcb3e42b6, 0x597f299c, 0xfc657e2a,
	0x5fcb6fab, 0x3ad6faec, 0x6c44198c, 0x4a475817,
}

var iv512 = [16]uint32{
	0x6a09e667, 0xf3bcc908, 0xbb67ae85, 0x84caa73b,
	0x3c6ef372, 0xfe94f82b, 0xa54ff53a, 0x5f1d36f1,
	0x510e527f, 0xade682d1, 0x9b05688c, 0x2b3e6c1f,
	0x1f83d9ab, 0xfb41bd6b, 0x5be0cd19, 0x137e2179,
}

var iv224 = [16]uint32{
	0x8c3d37c8, 0x19544da2, 0x73e19966, 0x89dcd4d6,
	0x1dfab7ae, 0x32ff9c82, 0x679dd514, 0x582f9fcf,
	0x0f6d2b69, 0x7bd44da8, 0x77e36f73, 0x04c48942,
	0x3f9d85a8, 0x6a1d36c8, 0x1112e6ad, 0x91d692a1,
}

var iv256 = [16]uint32{
	0x22312194, 0xfc2bf72c, 0x9f555fa3, 0xc84c64c2,
	0x2393b86b, 0x6f53b151, 0x96387719, 0x5940eabd,
	0x96283ee2, 0xa88effe3, 0xbe5e1e25, 0x53863992,
	0x2b0199fc, 0x2c85b8aa, 0x0eb72ddc, 0x81c52ca2,
}

var iv384 = [16]uint32{
	0xcbbb9d5d, 0xc1059ed8, 0x629a292a, 0x367cd507,
	0x9159015a, 0x3070dd17, 0x152fecd8, 0xf70e5939,
	0x67332667, 0xffc00b31, 0x8eb44a87, 0x68581511,
	0xdb0c2e0d, 0x64f98fa7, 0x47b5481d, 0xbefa4fa4,
}

// digest holds the partial evaluation of a checksum. h holds eight 64-bit
// words as (high, low) uint32 pairs; the byte count is lenHi:lenLo.
type digest struct {
	h     [16]uint32
	x     [128]byte
	nx    int
	lenLo uint32
	lenHi uint32
	size  int
	iv    int
}

func (d *digest) Reset() {
	var src [16]uint32
	switch d.iv {
	case 384:
		src = iv384
	case 224:
		src = iv224
	case 256:
		src = iv256
	default:
		src = iv512
	}
	for i := 0; i < 16; i++ {
		d.h[i] = src[i]
	}
	d.nx = 0
	d.lenLo = 0
	d.lenHi = 0
}

func newDigest(iv, size int) *digest {
	d := new(digest)
	d.iv = iv
	d.size = size
	d.Reset()
	return d
}

// New returns a new hash.Hash computing the SHA-512 checksum.
func New() hash.Hash { return newDigest(512, 64) }

// New512_224 returns a new hash.Hash computing the SHA-512/224 checksum.
func New512_224() hash.Hash { return newDigest(224, 28) }

// New512_256 returns a new hash.Hash computing the SHA-512/256 checksum.
func New512_256() hash.Hash { return newDigest(256, 32) }

// New384 returns a new hash.Hash computing the SHA-384 checksum.
func New384() hash.Hash { return newDigest(384, 48) }

func (d *digest) Size() int { return d.size }

func (d *digest) BlockSize() int { return 128 }

func (d *digest) Clone() (hash.Cloner, error) {
	r := *d
	return &r, nil
}

func (d *digest) Write(p []byte) (nn int, err error) {
	nn = len(p)
	old := d.lenLo
	d.lenLo += uint32(nn)
	if d.lenLo < old {
		d.lenHi++
	}
	if d.nx > 0 {
		n := copy(d.x[d.nx:], p)
		d.nx += n
		if d.nx == 128 {
			block(d, d.x[:])
			d.nx = 0
		}
		p = p[n:]
	}
	if len(p) >= 128 {
		n := len(p) &^ 127
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
	return append(in, sum[:d.size]...)
}

func (d *digest) checkSum() [64]byte {
	lenLo, lenHi := d.lenLo, d.lenHi
	var tmp [144]byte
	tmp[0] = 0x80
	pad := (111 - int(lenLo&127) + 128) % 128
	n := 1 + pad
	// 128-bit big-endian bit count.
	top := lenHi >> 29
	hi := lenHi<<3 | lenLo>>29
	lo := lenLo << 3
	tmp[n+4] = byte(top >> 24)
	tmp[n+5] = byte(top >> 16)
	tmp[n+6] = byte(top >> 8)
	tmp[n+7] = byte(top)
	tmp[n+8] = byte(hi >> 24)
	tmp[n+9] = byte(hi >> 16)
	tmp[n+10] = byte(hi >> 8)
	tmp[n+11] = byte(hi)
	tmp[n+12] = byte(lo >> 24)
	tmp[n+13] = byte(lo >> 16)
	tmp[n+14] = byte(lo >> 8)
	tmp[n+15] = byte(lo)
	d.Write(tmp[:n+16])

	var out [64]byte
	for i := 0; i < 16; i++ {
		s := d.h[i]
		out[i*4] = byte(s >> 24)
		out[i*4+1] = byte(s >> 16)
		out[i*4+2] = byte(s >> 8)
		out[i*4+3] = byte(s)
	}
	return out
}

func sum(iv, size int, data []byte) [64]byte {
	d := newDigest(iv, size)
	d.Write(data)
	return d.checkSum()
}

// Sum512 returns the SHA512 checksum of the data.
func Sum512(data []byte) [64]byte {
	return sum(512, 64, data)
}

// Sum384 returns the SHA384 checksum of the data.
func Sum384(data []byte) [48]byte {
	full := sum(384, 48, data)
	var out [48]byte
	for i := 0; i < 48; i++ {
		out[i] = full[i]
	}
	return out
}

// Sum512_224 returns the Sum512/224 checksum of the data.
func Sum512_224(data []byte) [28]byte {
	full := sum(224, 28, data)
	var out [28]byte
	for i := 0; i < 28; i++ {
		out[i] = full[i]
	}
	return out
}

// Sum512_256 returns the Sum512/256 checksum of the data.
func Sum512_256(data []byte) [32]byte {
	full := sum(256, 32, data)
	var out [32]byte
	for i := 0; i < 32; i++ {
		out[i] = full[i]
	}
	return out
}

// add64 returns (ah:al) + (bh:bl) modulo 2^64.
func add64(ah, al, bh, bl uint32) (uint32, uint32) {
	l := al + bl
	h := ah + bh
	if l < al {
		h++
	}
	return h, l
}

// rotr64 rotates (h:l) right by n bits, 0 < n < 64, n != 32.
func rotr64(h, l uint32, n uint) (uint32, uint32) {
	if n > 32 {
		h, l = l, h
		n -= 32
	}
	return h>>n | l<<(32-n), l>>n | h<<(32-n)
}

// shr64 shifts (h:l) right by n bits, 0 < n < 32.
func shr64(h, l uint32, n uint) (uint32, uint32) {
	return h >> n, l>>n | h<<(32-n)
}

func block(dig *digest, p []byte) {
	var w [160]uint32
	for len(p) >= 128 {
		for i := 0; i < 32; i++ {
			j := i * 4
			w[i] = uint32(p[j])<<24 | uint32(p[j+1])<<16 | uint32(p[j+2])<<8 | uint32(p[j+3])
		}
		for t := 16; t < 80; t++ {
			// sigma1(w[t-2])
			h2, l2 := w[2*(t-2)], w[2*(t-2)+1]
			ah, al := rotr64(h2, l2, 19)
			bh, bl := rotr64(h2, l2, 61)
			ch, cl := shr64(h2, l2, 6)
			s1h, s1l := ah^bh^ch, al^bl^cl
			// sigma0(w[t-15])
			h15, l15 := w[2*(t-15)], w[2*(t-15)+1]
			ah, al = rotr64(h15, l15, 1)
			bh, bl = rotr64(h15, l15, 8)
			ch, cl = shr64(h15, l15, 7)
			s0h, s0l := ah^bh^ch, al^bl^cl

			rh, rl := add64(s1h, s1l, w[2*(t-7)], w[2*(t-7)+1])
			rh, rl = add64(rh, rl, s0h, s0l)
			rh, rl = add64(rh, rl, w[2*(t-16)], w[2*(t-16)+1])
			w[2*t] = rh
			w[2*t+1] = rl
		}

		ah, al := dig.h[0], dig.h[1]
		bh, bl := dig.h[2], dig.h[3]
		ch, cl := dig.h[4], dig.h[5]
		dh, dl := dig.h[6], dig.h[7]
		eh, el := dig.h[8], dig.h[9]
		fh, fl := dig.h[10], dig.h[11]
		gh, gl := dig.h[12], dig.h[13]
		hh, hl := dig.h[14], dig.h[15]

		for t := 0; t < 80; t++ {
			// Sigma1(e)
			xh, xl := rotr64(eh, el, 14)
			yh, yl := rotr64(eh, el, 18)
			zh, zl := rotr64(eh, el, 41)
			S1h, S1l := xh^yh^zh, xl^yl^zl
			// Ch(e, f, g)
			chh := (eh & fh) ^ (^eh & gh)
			chl := (el & fl) ^ (^el & gl)

			t1h, t1l := add64(hh, hl, S1h, S1l)
			t1h, t1l = add64(t1h, t1l, chh, chl)
			t1h, t1l = add64(t1h, t1l, k512[2*t], k512[2*t+1])
			t1h, t1l = add64(t1h, t1l, w[2*t], w[2*t+1])

			// Sigma0(a)
			xh, xl = rotr64(ah, al, 28)
			yh, yl = rotr64(ah, al, 34)
			zh, zl = rotr64(ah, al, 39)
			S0h, S0l := xh^yh^zh, xl^yl^zl
			// Maj(a, b, c)
			mjh := (ah & bh) ^ (ah & ch) ^ (bh & ch)
			mjl := (al & bl) ^ (al & cl) ^ (bl & cl)
			t2h, t2l := add64(S0h, S0l, mjh, mjl)

			hh, hl = gh, gl
			gh, gl = fh, fl
			fh, fl = eh, el
			eh, el = add64(dh, dl, t1h, t1l)
			dh, dl = ch, cl
			ch, cl = bh, bl
			bh, bl = ah, al
			ah, al = add64(t1h, t1l, t2h, t2l)
		}

		nh, nl := add64(dig.h[0], dig.h[1], ah, al)
		dig.h[0] = nh
		dig.h[1] = nl
		nh, nl = add64(dig.h[2], dig.h[3], bh, bl)
		dig.h[2] = nh
		dig.h[3] = nl
		nh, nl = add64(dig.h[4], dig.h[5], ch, cl)
		dig.h[4] = nh
		dig.h[5] = nl
		nh, nl = add64(dig.h[6], dig.h[7], dh, dl)
		dig.h[6] = nh
		dig.h[7] = nl
		nh, nl = add64(dig.h[8], dig.h[9], eh, el)
		dig.h[8] = nh
		dig.h[9] = nl
		nh, nl = add64(dig.h[10], dig.h[11], fh, fl)
		dig.h[10] = nh
		dig.h[11] = nl
		nh, nl = add64(dig.h[12], dig.h[13], gh, gl)
		dig.h[12] = nh
		dig.h[13] = nl
		nh, nl = add64(dig.h[14], dig.h[15], hh, hl)
		dig.h[14] = nh
		dig.h[15] = nl

		p = p[128:]
	}
}
