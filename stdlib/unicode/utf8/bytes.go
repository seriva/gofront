//go:build gofront

//gofront:target both

package utf8

// RuneSelf characters below RuneSelf are represented as themselves in a single byte.
const RuneSelf = 0x80

const (
	t2 = 0b11000000
	t3 = 0b11100000
	t4 = 0b11110000

	maskx = 0b00111111
	mask2 = 0b00011111
	mask3 = 0b00001111
	mask4 = 0b00000111

	locb = 0b10000000
	hicb = 0b10111111

	xx = 0xF1 // invalid: size 1
	as = 0xF0 // ASCII: size 1
	s1 = 0x02 // accept 0, size 2
	s2 = 0x13 // accept 1, size 3
	s3 = 0x03 // accept 0, size 3
	s4 = 0x23 // accept 2, size 3
	s5 = 0x34 // accept 3, size 4
	s6 = 0x04 // accept 0, size 4
	s7 = 0x44 // accept 4, size 4
)

var first = [256]uint8{
	as, as, as, as, as, as, as, as, as, as, as, as, as, as, as, as,
	as, as, as, as, as, as, as, as, as, as, as, as, as, as, as, as,
	as, as, as, as, as, as, as, as, as, as, as, as, as, as, as, as,
	as, as, as, as, as, as, as, as, as, as, as, as, as, as, as, as,
	as, as, as, as, as, as, as, as, as, as, as, as, as, as, as, as,
	as, as, as, as, as, as, as, as, as, as, as, as, as, as, as, as,
	as, as, as, as, as, as, as, as, as, as, as, as, as, as, as, as,
	as, as, as, as, as, as, as, as, as, as, as, as, as, as, as, as,
	xx, xx, xx, xx, xx, xx, xx, xx, xx, xx, xx, xx, xx, xx, xx, xx,
	xx, xx, xx, xx, xx, xx, xx, xx, xx, xx, xx, xx, xx, xx, xx, xx,
	xx, xx, xx, xx, xx, xx, xx, xx, xx, xx, xx, xx, xx, xx, xx, xx,
	xx, xx, xx, xx, xx, xx, xx, xx, xx, xx, xx, xx, xx, xx, xx, xx,
	xx, xx, s1, s1, s1, s1, s1, s1, s1, s1, s1, s1, s1, s1, s1, s1,
	s1, s1, s1, s1, s1, s1, s1, s1, s1, s1, s1, s1, s1, s1, s1, s1,
	s2, s3, s3, s3, s3, s3, s3, s3, s3, s3, s3, s3, s3, s4, s3, s3,
	s5, s6, s6, s6, s7, xx, xx, xx, xx, xx, xx, xx, xx, xx, xx, xx,
}

type acceptRange struct {
	lo uint8
	hi uint8
}

var acceptRanges = [16]acceptRange{
	0: {locb, hicb},
	1: {0xA0, hicb},
	2: {locb, 0x9F},
	3: {0x90, hicb},
	4: {locb, 0x8F},
}

// RuneStart reports whether the byte could be the first byte of an encoded rune.
func RuneStart(b byte) bool {
	return b&0xC0 != 0x80
}

// FullRune reports whether the bytes in p begin with a full UTF-8 encoding of a rune.
func FullRune(p []byte) bool {
	n := len(p)
	if n == 0 {
		return false
	}
	x := first[p[0]]
	if n >= int(x&7) {
		return true
	}
	accept := acceptRanges[x>>4]
	if n > 1 && (p[1] < accept.lo || p[1] > accept.hi) {
		return true
	} else if n > 2 && (p[2] < locb || p[2] > hicb) {
		return true
	}
	return false
}

func decodeMulti(p []byte, p0 byte) (rune, int) {
	x := first[p0]
	if x >= as {
		return RuneError, 1
	}
	sz := int(x & 7)
	accept := acceptRanges[x>>4]
	if len(p) < sz {
		return RuneError, 1
	}
	b1 := p[1]
	if b1 < accept.lo || b1 > accept.hi {
		return RuneError, 1
	}
	if sz <= 2 {
		return rune(p0&mask2)<<6 | rune(b1&maskx), 2
	}
	b2 := p[2]
	if b2 < locb || b2 > hicb {
		return RuneError, 1
	}
	if sz <= 3 {
		return rune(p0&mask3)<<12 | rune(b1&maskx)<<6 | rune(b2&maskx), 3
	}
	b3 := p[3]
	if b3 < locb || b3 > hicb {
		return RuneError, 1
	}
	return rune(p0&mask4)<<18 | rune(b1&maskx)<<12 | rune(b2&maskx)<<6 | rune(b3&maskx), 4
}

// DecodeRune unpacks the first UTF-8 encoding in p and returns the rune and its width in bytes.
func DecodeRune(p []byte) (r rune, size int) {
	if len(p) < 1 {
		return RuneError, 0
	}
	p0 := p[0]
	if p0 < RuneSelf {
		return rune(p0), 1
	}
	r, size = decodeMulti(p, p0)
	return r, size
}

// DecodeLastRune unpacks the last UTF-8 encoding in p and returns the rune and its width in bytes.
func DecodeLastRune(p []byte) (r rune, size int) {
	end := len(p)
	if end == 0 {
		return RuneError, 0
	}
	start := end - 1
	if p[start] < RuneSelf {
		return rune(p[start]), 1
	}
	lim := end - UTFMax
	if lim < 0 {
		lim = 0
	}
	for start--; start >= lim; start-- {
		if RuneStart(p[start]) {
			break
		}
	}
	if start < 0 {
		start = 0
	}
	r, size = DecodeRune(p[start:end])
	if start+size != end {
		return RuneError, 1
	}
	return r, size
}

// EncodeRune writes into p (which must be large enough) the UTF-8 encoding of the rune.
func EncodeRune(p []byte, r rune) int {
	switch i := uint32(r); {
	case i <= 0x7F:
		p[0] = byte(r)
		return 1
	case i <= 0x7FF:
		p[0] = t2 | byte(r>>6)
		p[1] = locb | byte(r)&maskx
		return 2
	case i < 0xD800, i > 0xDFFF && i <= 0xFFFF:
		p[0] = t3 | byte(r>>12)
		p[1] = locb | byte(r>>6)&maskx
		p[2] = locb | byte(r)&maskx
		return 3
	case i > 0xFFFF && i <= MaxRune:
		p[0] = t4 | byte(r>>18)
		p[1] = locb | byte(r>>12)&maskx
		p[2] = locb | byte(r>>6)&maskx
		p[3] = locb | byte(r)&maskx
		return 4
	default:
		p[0] = 0xEF
		p[1] = 0xBF
		p[2] = 0xBD
		return 3
	}
}

// AppendRune appends the UTF-8 encoding of r to the end of p.
func AppendRune(p []byte, r rune) []byte {
	switch i := uint32(r); {
	case i <= 0x7F:
		return append(p, byte(r))
	case i <= 0x7FF:
		return append(p, t2|byte(r>>6), locb|byte(r)&maskx)
	case i < 0xD800, i > 0xDFFF && i <= 0xFFFF:
		return append(p, t3|byte(r>>12), locb|byte(r>>6)&maskx, locb|byte(r)&maskx)
	case i > 0xFFFF && i <= MaxRune:
		return append(p, t4|byte(r>>18), locb|byte(r>>12)&maskx, locb|byte(r>>6)&maskx, locb|byte(r)&maskx)
	default:
		return append(p, 0xEF, 0xBF, 0xBD)
	}
}

// RuneCount returns the number of runes in p.
func RuneCount(p []byte) int {
	np := len(p)
	var n int
	for i := 0; i < np; {
		if p[i] < RuneSelf {
			i++
			n++
			continue
		}
		_, sz := DecodeRune(p[i:])
		i += sz
		n++
	}
	return n
}

// Valid reports whether p consists entirely of valid UTF-8-encoded runes.
func Valid(p []byte) bool {
	for len(p) > 0 {
		if p[0] < RuneSelf {
			p = p[1:]
			continue
		}
		_, sz := DecodeRune(p)
		if sz == 1 {
			return false
		}
		p = p[sz:]
	}
	return true
}
