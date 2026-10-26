//go:build gofront

//gofront:target both

package rand

import "errors"

// A PCG is a PCG generator with 128 bits of internal state.
// A zero PCG is ready to use and equivalent to NewPCG(0, 0).
type PCG struct {
	hi u64
	lo u64
}

// NewPCG returns a new PCG seeded with the given values.
func NewPCG(seed1, seed2 uint64) *PCG {
	return &PCG{fromUint64(seed1), fromUint64(seed2)}
}

// Seed resets the PCG to behave the same way as NewPCG(seed1, seed2).
func (p *PCG) Seed(seed1, seed2 uint64) {
	p.hi = fromUint64(seed1)
	p.lo = fromUint64(seed2)
}

func appendBE32(b []byte, x uint32) []byte {
	return append(b, byte(x>>24), byte(x>>16), byte(x>>8), byte(x))
}

func beUint32(b []byte) uint32 {
	return uint32(b[3]) | uint32(b[2])<<8 | uint32(b[1])<<16 | uint32(b[0])<<24
}

// AppendBinary implements the encoding.BinaryAppender interface.
func (p *PCG) AppendBinary(b []byte) ([]byte, error) {
	b = append(b, 'p', 'c', 'g', ':')
	b = appendBE32(b, p.hi.hi)
	b = appendBE32(b, p.hi.lo)
	b = appendBE32(b, p.lo.hi)
	b = appendBE32(b, p.lo.lo)
	return b, nil
}

// MarshalBinary implements the encoding.BinaryMarshaler interface.
func (p *PCG) MarshalBinary() ([]byte, error) {
	b, err := p.AppendBinary(make([]byte, 0, 20))
	return b, err
}

var errUnmarshalPCG = errors.New("invalid PCG encoding")

// UnmarshalBinary implements the encoding.BinaryUnmarshaler interface.
func (p *PCG) UnmarshalBinary(data []byte) error {
	if len(data) != 20 || data[0] != 'p' || data[1] != 'c' || data[2] != 'g' || data[3] != ':' {
		return errUnmarshalPCG
	}
	p.hi = u64{beUint32(data[4:]), beUint32(data[8:])}
	p.lo = u64{beUint32(data[12:]), beUint32(data[16:])}
	return nil
}

// The multiplier and increment of the 128-bit linear congruential step, as
// halves of the two 64-bit words.
var (
	pcgMulHi = u64{0x2360ed05, 0x1fc65da4}
	pcgMulLo = u64{0x4385df64, 0x9fccf645}
	pcgIncHi = u64{0x5851f42d, 0x4c957f2d}
	pcgIncLo = u64{0x14057b7e, 0xf767814f}
	pcgCheap = u64{0xda942042, 0xe4dd58b5}
)

func (p *PCG) next() (hi u64, lo u64) {
	// state = state * mul + inc
	hi, lo = mul64(p.lo, pcgMulLo)
	hi, _ = add64(hi, mulLow64(p.hi, pcgMulLo))
	hi, _ = add64(hi, mulLow64(p.lo, pcgMulHi))
	var c uint32
	lo, c = add64(lo, pcgIncLo)
	hi, _ = add64(hi, pcgIncHi)
	hi, _ = add64(hi, u64{0, c})
	p.lo = lo
	p.hi = hi
	return hi, lo
}

// next64 returns the next output as two 32-bit halves.
func (p *PCG) next64() u64 {
	hi, lo := p.next()
	// DXSM "double xorshift multiply".
	hi.lo ^= hi.hi
	hi = mulLow64(hi, pcgCheap)
	hi.lo ^= hi.hi >> 16
	hi = mulLow64(hi, u64{lo.hi, lo.lo | 1})
	return hi
}

// Uint64 return a uniformly-distributed random uint64 value.
func (p *PCG) Uint64() uint64 {
	return p.next64().uint64()
}
