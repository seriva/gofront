//go:build gofront

//gofront:target both

// Overlay on the emitter-backed bytes package: search and comparison members
// written in Go and merged into the bytes namespace.  They work on byte
// offsets and decode UTF-8 as Go does, so an invalid sequence reads as
// (RuneError, 1).
package bytes

import "unicode"

// decodeLastRune unpacks the last UTF-8 encoding in p and returns the rune and
// its width in bytes, as utf8.DecodeLastRune does: an invalid or incomplete
// encoding is (RuneError, 1) and p must not be empty.
func decodeLastRune(p []byte) (rune, int) {
	end := len(p)
	r := rune(p[end-1])
	if r < runeSelf {
		return r, 1
	}
	start := end - 1
	lim := end - 4
	if lim < 0 {
		lim = 0
	}
	for start--; start >= lim; start-- {
		if p[start]&0xC0 != 0x80 {
			break
		}
	}
	if start < 0 {
		start = 0
	}
	r, size := decodeRune(p[start:end])
	if start+size != end {
		return runeError, 1
	}
	return r, size
}

// Compare returns an integer comparing two byte slices lexicographically.
// The result will be 0 if a == b, -1 if a < b, and +1 if a > b.
// A nil argument is equivalent to an empty slice.
func Compare(a, b []byte) int {
	n := len(a)
	if len(b) < n {
		n = len(b)
	}
	for i := 0; i < n; i++ {
		if a[i] != b[i] {
			if a[i] < b[i] {
				return -1
			}
			return 1
		}
	}
	if len(a) < len(b) {
		return -1
	}
	if len(a) > len(b) {
		return 1
	}
	return 0
}

// EqualFold reports whether s and t, interpreted as UTF-8 strings,
// are equal under simple Unicode case-folding, which is a more general
// form of case-insensitivity.
func EqualFold(s, t []byte) bool {
	for len(s) != 0 && len(t) != 0 {
		var sr, tr rune
		if s[0] < runeSelf {
			sr, s = rune(s[0]), s[1:]
		} else {
			r, size := decodeRune(s)
			sr, s = r, s[size:]
		}
		if t[0] < runeSelf {
			tr, t = rune(t[0]), t[1:]
		} else {
			r, size := decodeRune(t)
			tr, t = r, t[size:]
		}
		if tr == sr {
			continue
		}
		if tr < sr {
			tr, sr = sr, tr
		}
		if tr < runeSelf {
			if 'A' <= sr && sr <= 'Z' && tr == sr+'a'-'A' {
				continue
			}
			return false
		}
		r := unicode.SimpleFold(sr)
		for r != sr && r < tr {
			r = unicode.SimpleFold(r)
		}
		if r == tr {
			continue
		}
		return false
	}
	return len(s) == len(t)
}

// IndexRune interprets s as a sequence of UTF-8-encoded code points.
// It returns the byte index of the first occurrence in s of the given rune.
// It returns -1 if rune is not present in s.
// If r is utf8.RuneError, it returns the first instance of any
// invalid UTF-8 byte sequence.
func IndexRune(s []byte, r rune) int {
	if r < 0 || r > 0x10FFFF || (r >= 0xD800 && r <= 0xDFFF) {
		return -1
	}
	if r < runeSelf {
		return IndexByte(s, int(r))
	}
	for i := 0; i < len(s); {
		c, size := decodeRune(s[i:])
		if c == r {
			return i
		}
		i += size
	}
	return -1
}

// containsRuneIn reports whether chars contains r, treating an invalid sequence
// in chars as utf8.RuneError.
func containsRuneIn(chars string, r rune) bool {
	for _, c := range chars {
		if c == r {
			return true
		}
	}
	return false
}

// IndexAny interprets s as a sequence of UTF-8-encoded Unicode code points.
// It returns the byte index of the first occurrence in s of any of the Unicode
// code points in chars. It returns -1 if chars is empty or if there is no code
// point in common.
func IndexAny(s []byte, chars string) int {
	if len(chars) == 0 {
		return -1
	}
	for i := 0; i < len(s); {
		r, size := decodeRune(s[i:])
		if containsRuneIn(chars, r) {
			return i
		}
		i += size
	}
	return -1
}

// LastIndexAny interprets s as a sequence of UTF-8-encoded Unicode code
// points. It returns the byte index of the last occurrence in s of any of
// the Unicode code points in chars. It returns -1 if chars is empty or if
// there is no code point in common.
func LastIndexAny(s []byte, chars string) int {
	if len(chars) == 0 {
		return -1
	}
	for i := len(s); i > 0; {
		r, size := decodeLastRune(s[:i])
		i -= size
		if containsRuneIn(chars, r) {
			return i
		}
	}
	return -1
}

func indexFunc(s []byte, f func(rune) bool, truth bool) int {
	for i := 0; i < len(s); {
		r, size := decodeRune(s[i:])
		if f(r) == truth {
			return i
		}
		i += size
	}
	return -1
}

func lastIndexFunc(s []byte, f func(rune) bool, truth bool) int {
	for i := len(s); i > 0; {
		r, size := decodeLastRune(s[:i])
		i -= size
		if f(r) == truth {
			return i
		}
	}
	return -1
}

// IndexFunc interprets s as a sequence of UTF-8-encoded code points.
// It returns the byte index in s of the first Unicode
// code point satisfying f(c), or -1 if none do.
func IndexFunc(s []byte, f func(r rune) bool) int {
	return indexFunc(s, f, true)
}

// LastIndexFunc interprets s as a sequence of UTF-8-encoded code points.
// It returns the byte index in s of the last Unicode
// code point satisfying f(c), or -1 if none do.
func LastIndexFunc(s []byte, f func(r rune) bool) int {
	return lastIndexFunc(s, f, true)
}

// ContainsFunc reports whether any of the UTF-8-encoded code points
// in b satisfy f(c).
func ContainsFunc(b []byte, f func(rune) bool) bool {
	return indexFunc(b, f, true) >= 0
}

// CutPrefix returns s without the provided leading prefix byte slice
// and reports whether it found the prefix.
// If s doesn't start with prefix, CutPrefix returns s, false.
// If prefix is the empty byte slice, CutPrefix returns s, true.
func CutPrefix(s, prefix []byte) (after []byte, found bool) {
	if len(s) < len(prefix) || Compare(s[:len(prefix)], prefix) != 0 {
		return s, false
	}
	return s[len(prefix):], true
}

// CutSuffix returns s without the provided ending suffix byte slice
// and reports whether it found the suffix.
// If s doesn't end with suffix, CutSuffix returns s, false.
// If suffix is the empty byte slice, CutSuffix returns s, true.
func CutSuffix(s, suffix []byte) (before []byte, found bool) {
	if len(s) < len(suffix) || Compare(s[len(s)-len(suffix):], suffix) != 0 {
		return s, false
	}
	return s[:len(s)-len(suffix)], true
}
