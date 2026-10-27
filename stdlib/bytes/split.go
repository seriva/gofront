//go:build gofront

//gofront:target both

// Overlay on the emitter-backed bytes package: splitting, trimming and
// case members written in Go and merged into the bytes namespace.  Like Go's,
// the slices SplitAfter and SplitAfterN return alias the input and have their
// capacity clipped.
package bytes

import (
	"errors"
	"unicode"
)

// MinRead is the minimum slice size passed to a Read call by
// Buffer.ReadFrom. As long as the Buffer has at least MinRead bytes beyond
// what is required to hold the contents of r, ReadFrom will not grow the
// underlying buffer.
const MinRead = 512

// ErrTooLarge is passed to panic if memory cannot be allocated to store data in a buffer.
var ErrTooLarge = errors.New("bytes.Buffer: too large")

// runeCount returns the number of runes in p, counting each invalid byte as
// one rune as utf8.RuneCount does.
func runeCount(p []byte) int {
	n := 0
	for i := 0; i < len(p); n++ {
		_, size := decodeRune(p[i:])
		i += size
	}
	return n
}

// countSep counts the non-overlapping instances of sep in s; sep must not be
// empty.
func countSep(s, sep []byte) int {
	n := 0
	for {
		i := index(s, sep)
		if i < 0 {
			return n
		}
		n++
		s = s[i+len(sep):]
	}
}

// explode splits s into a slice of UTF-8 sequences, one per Unicode code point
// (still slices of bytes), up to a maximum of n byte slices. Invalid UTF-8
// sequences are chopped into individual bytes.
func explode(s []byte, n int) [][]byte {
	l := runeCount(s)
	if n < 0 || n > l {
		n = l
	}
	a := make([][]byte, n)
	for i := 0; i < n-1; i++ {
		_, size := decodeRune(s)
		a[i] = s[:size:size]
		s = s[size:]
	}
	if n > 0 {
		a[n-1] = s[:len(s):len(s)]
	}
	return a
}

// genSplit splits s around sep, including sepSave bytes of sep in each
// subslice, into at most n subslices.
func genSplit(s, sep []byte, sepSave, n int) [][]byte {
	if n == 0 {
		return nil
	}
	if len(sep) == 0 {
		return explode(s, n)
	}
	if n < 0 {
		n = countSep(s, sep) + 1
	}
	if n > len(s)+1 {
		n = len(s) + 1
	}
	a := make([][]byte, n)
	n--
	i := 0
	for i < n {
		m := index(s, sep)
		if m < 0 {
			break
		}
		a[i] = s[: m+sepSave : m+sepSave]
		s = s[m+len(sep):]
		i++
	}
	a[i] = s[:len(s):len(s)]
	return a[:i+1]
}

// SplitAfter slices s into all subslices after each instance of sep and
// returns a slice of those subslices.
// If sep is empty, SplitAfter splits after each UTF-8 sequence.
// It is equivalent to SplitAfterN with a count of -1.
func SplitAfter(s, sep []byte) [][]byte {
	return genSplit(s, sep, len(sep), -1)
}

// SplitAfterN slices s into subslices after each instance of sep and
// returns a slice of those subslices.
// The count determines the number of subslices to return:
//   - n > 0: at most n subslices; the last subslice will be the unsplit remainder;
//   - n == 0: the result is nil (zero subslices);
//   - n < 0: all subslices.
func SplitAfterN(s, sep []byte, n int) [][]byte {
	return genSplit(s, sep, len(sep), n)
}

// Runes interprets s as a sequence of UTF-8-encoded code points.
// It returns a slice of runes (Unicode code points) equivalent to s.
func Runes(s []byte) []rune {
	t := make([]rune, runeCount(s))
	i := 0
	for len(s) > 0 {
		r, l := decodeRune(s)
		t[i] = r
		i++
		s = s[l:]
	}
	return t
}

// isSeparator reports whether the rune could mark a word boundary.
func isSeparator(r rune) bool {
	if r <= 0x7F {
		switch {
		case '0' <= r && r <= '9':
			return false
		case 'a' <= r && r <= 'z':
			return false
		case 'A' <= r && r <= 'Z':
			return false
		case r == '_':
			return false
		}
		return true
	}
	if unicode.IsLetter(int(r)) || unicode.IsDigit(int(r)) {
		return false
	}
	return unicode.IsSpace(int(r))
}

// appendRune appends the UTF-8 encoding of r to p, writing RuneError for a
// value that is not a valid code point.
// The continuation bytes mask a byte(r>>n) rather than r>>n: the JS backend
// drops the parentheses around a wrapped int32 shift in `x | r>>n&m`.
func appendRune(p []byte, r rune) []byte {
	switch {
	case r < 0 || r > 0x10FFFF || (r >= 0xD800 && r <= 0xDFFF):
		r = runeError
	case r < 0x80:
		return append(p, byte(r))
	}
	switch {
	case r < 0x800:
		return append(p, byte(0xC0|r>>6), byte(0x80|r&0x3F))
	case r < 0x10000:
		return append(p, byte(0xE0|r>>12), 0x80|byte(r>>6)&0x3F, byte(0x80|r&0x3F))
	}
	return append(p, byte(0xF0|r>>18), 0x80|byte(r>>12)&0x3F, 0x80|byte(r>>6)&0x3F, byte(0x80|r&0x3F))
}

// Title treats s as UTF-8-encoded bytes and returns a copy with all Unicode
// letters that begin words mapped to their title case.
//
// Deprecated: The rule Title uses for word boundaries does not handle Unicode
// punctuation properly.
func Title(s []byte) []byte {
	prev := rune(' ')
	out := make([]byte, 0, len(s))
	for i := 0; i < len(s); {
		r, size := decodeRune(s[i:])
		i += size
		c := r
		if isSeparator(prev) {
			c = unicode.ToTitle(r)
		}
		prev = r
		if c >= 0 {
			out = appendRune(out, c)
		}
	}
	return out
}

// TrimLeftFunc treats s as UTF-8-encoded bytes and returns a subslice of s by slicing off
// all leading UTF-8-encoded code points c that satisfy f(c).
func TrimLeftFunc(s []byte, f func(r rune) bool) []byte {
	i := indexFunc(s, f, false)
	if i == -1 {
		return nil
	}
	return s[i:]
}

// TrimRightFunc returns a subslice of s by slicing off all trailing
// UTF-8-encoded code points c that satisfy f(c).
func TrimRightFunc(s []byte, f func(r rune) bool) []byte {
	i := lastIndexFunc(s, f, false)
	if i >= 0 && s[i] >= runeSelf {
		_, wid := decodeRune(s[i:])
		i += wid
	} else {
		i++
	}
	return s[0:i]
}
