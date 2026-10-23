//go:build gofront

//gofront:target both

// Overlay on the emitter-backed bytes package: the sequence members of
// Go 1.24 are written in Go over iter.Seq and merged into the bytes
// namespace.  Like Go's, the slices they yield alias the input and have their
// capacity clipped, so appending to one does not write into the original.
package bytes

import (
	"iter"
	"unicode"
)

const (
	runeError = 0xFFFD
	runeSelf  = 0x80
)

// decodeRune unpacks the first UTF-8 encoding in p and returns the rune and
// its width in bytes, as utf8.DecodeRune does: an invalid or incomplete
// encoding is (RuneError, 1) and p must not be empty.
func decodeRune(p []byte) (rune, int) {
	b0 := int(p[0])
	if b0 < runeSelf {
		return rune(b0), 1
	}
	n, lo, mask := 0, 0, 0
	if b0 >= 0xC2 && b0 <= 0xDF {
		n, lo, mask = 2, 0x80, 0x1F
	} else if b0 >= 0xE0 && b0 <= 0xEF {
		n, lo, mask = 3, 0x800, 0x0F
	} else if b0 >= 0xF0 && b0 <= 0xF4 {
		n, lo, mask = 4, 0x10000, 0x07
	} else {
		return runeError, 1
	}
	if len(p) < n {
		return runeError, 1
	}
	r := b0 & mask
	for i := 1; i < n; i++ {
		b := int(p[i])
		if b&0xC0 != 0x80 {
			return runeError, 1
		}
		r = r<<6 | b&0x3F
	}
	if r < lo || r > 0x10FFFF || (r >= 0xD800 && r <= 0xDFFF) {
		return runeError, 1
	}
	return rune(r), n
}

// index returns the byte offset of the first instance of sep in s, or -1.
// It compares bytes: the emitter's bytes.Index goes through a decoded JS
// string on the JS backend and so counts characters, not bytes, once s holds
// multi-byte text.  sep must not be empty.
func index(s, sep []byte) int {
	first := sep[0]
	for i := 0; i+len(sep) <= len(s); i++ {
		if s[i] != first {
			continue
		}
		j := 1
		for j < len(sep) && s[i+j] == sep[j] {
			j++
		}
		if j == len(sep) {
			return i
		}
	}
	return -1
}

// isSpace is unicode.IsSpace as a func(rune) bool (the checker types the
// unicode predicates over int).
func isSpace(r rune) bool {
	return unicode.IsSpace(int(r))
}

// Lines returns an iterator over the newline-terminated lines in the byte slice s.
// The lines yielded by the iterator include their terminating newlines.
// If s is empty, the iterator yields no lines at all.
// If s does not end in a newline, the final yielded line will not end in a newline.
// The iterator yields slices of the original slice s.
func Lines(s []byte) iter.Seq[[]byte] {
	return func(yield func([]byte) bool) {
		for len(s) > 0 {
			var line []byte
			if i := IndexByte(s, '\n'); i >= 0 {
				line, s = s[:i+1:i+1], s[i+1:]
			} else {
				line, s = s[:len(s):len(s)], nil
			}
			if !yield(line) {
				return
			}
		}
	}
}

// explodeSeq returns an iterator over the UTF-8 encodings of the runes in s.
func explodeSeq(s []byte) iter.Seq[[]byte] {
	return func(yield func([]byte) bool) {
		for len(s) > 0 {
			_, size := decodeRune(s)
			if !yield(s[:size:size]) {
				return
			}
			s = s[size:]
		}
	}
}

// splitSeq is SplitSeq or SplitAfterSeq, configured by how many
// bytes of sep to include in the results (none or all).
func splitSeq(s, sep []byte, sepSave int) iter.Seq[[]byte] {
	if len(sep) == 0 {
		return explodeSeq(s)
	}
	return func(yield func([]byte) bool) {
		for {
			i := index(s, sep)
			if i < 0 {
				break
			}
			frag := s[:i+sepSave]
			if !yield(frag[:len(frag):len(frag)]) {
				return
			}
			s = s[i+len(sep):]
		}
		yield(s[:len(s):len(s)])
	}
}

// SplitSeq returns an iterator over subslices of s split around sep.
// The iterator yields the same subslices that would be returned by Split(s, sep),
// but without constructing the slice.
// It returns a single-use iterator.
func SplitSeq(s, sep []byte) iter.Seq[[]byte] {
	return splitSeq(s, sep, 0)
}

// SplitAfterSeq returns an iterator over subslices of s split after each instance of sep.
// The iterator yields the same subslices that would be returned by SplitAfter(s, sep),
// but without constructing the slice.
// It returns a single-use iterator.
func SplitAfterSeq(s, sep []byte) iter.Seq[[]byte] {
	return splitSeq(s, sep, len(sep))
}

// FieldsSeq returns an iterator over subslices of s split around runs of
// whitespace characters, as defined by unicode.IsSpace.
// The iterator yields the same subslices that would be returned by Fields(s),
// but without constructing the slice.
func FieldsSeq(s []byte) iter.Seq[[]byte] {
	return FieldsFuncSeq(s, isSpace)
}

// FieldsFuncSeq returns an iterator over subslices of s split around runs of
// Unicode code points satisfying f(c).
// The iterator yields the same subslices that would be returned by FieldsFunc(s),
// but without constructing the slice.
func FieldsFuncSeq(s []byte, f func(rune) bool) iter.Seq[[]byte] {
	return func(yield func([]byte) bool) {
		start := -1
		for i := 0; i < len(s); {
			size := 1
			r := rune(s[i])
			if r >= runeSelf {
				r, size = decodeRune(s[i:])
			}
			if f(r) {
				if start >= 0 {
					if !yield(s[start:i:i]) {
						return
					}
					start = -1
				}
			} else if start < 0 {
				start = i
			}
			i += size
		}
		if start >= 0 {
			yield(s[start:len(s):len(s)])
		}
	}
}
