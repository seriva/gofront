//go:build gofront

//gofront:target both

// Overlay on the emitter-backed strings package: the sequence members of
// Go 1.24 are written in Go over iter.Seq and merged into the strings
// namespace.  Strings are JavaScript strings, so Index and slicing count the
// same units and splitting at a substring is always consistent; the places
// that need code points (an empty separator, Fields) go through []rune.
package strings

import (
	"iter"
	"unicode"
)

// Lines returns an iterator over the newline-terminated lines in the string s.
// The lines yielded by the iterator include their terminating newlines.
// If s is empty, the iterator yields no lines at all.
// If s does not end in a newline, the final yielded line will not end in a newline.
func Lines(s string) iter.Seq[string] {
	return func(yield func(string) bool) {
		for len(s) > 0 {
			var line string
			if i := IndexByte(s, '\n'); i >= 0 {
				line, s = s[:i+1], s[i+1:]
			} else {
				line, s = s, ""
			}
			if !yield(line) {
				return
			}
		}
	}
}

// explodeSeq returns an iterator over the runes in s.
func explodeSeq(s string) iter.Seq[string] {
	return func(yield func(string) bool) {
		for _, r := range []rune(s) {
			if !yield(string(r)) {
				return
			}
		}
	}
}

// splitSeq is SplitSeq or SplitAfterSeq, configured by how many
// bytes of sep to include in the results (none or all).
func splitSeq(s, sep string, sepSave int) iter.Seq[string] {
	if len(sep) == 0 {
		return explodeSeq(s)
	}
	return func(yield func(string) bool) {
		for {
			i := Index(s, sep)
			if i < 0 {
				break
			}
			frag := s[:i+sepSave]
			if !yield(frag) {
				return
			}
			s = s[i+len(sep):]
		}
		yield(s)
	}
}

// SplitSeq returns an iterator over substrings of s split by sep.
// The iterator yields the same strings that would be returned by Split(s, sep),
// but without constructing the slice.
func SplitSeq(s, sep string) iter.Seq[string] {
	return splitSeq(s, sep, 0)
}

// SplitAfterSeq returns an iterator over substrings of s split after each instance of sep.
// The iterator yields the same strings that would be returned by SplitAfter(s, sep),
// but without constructing the slice.
func SplitAfterSeq(s, sep string) iter.Seq[string] {
	return splitSeq(s, sep, len(sep))
}

// isSpace is unicode.IsSpace as a func(rune) bool (the checker types the
// unicode predicates over int).
func isSpace(r rune) bool {
	return unicode.IsSpace(int(r))
}

// FieldsSeq returns an iterator over substrings of s split around runs of
// whitespace characters, as defined by unicode.IsSpace.
// The iterator yields the same strings that would be returned by Fields(s),
// but without constructing the slice.
func FieldsSeq(s string) iter.Seq[string] {
	return FieldsFuncSeq(s, isSpace)
}

// FieldsFuncSeq returns an iterator over substrings of s split around runs of
// Unicode code points satisfying f(c).
// The iterator yields the same strings that would be returned by FieldsFunc(s),
// but without constructing the slice.
func FieldsFuncSeq(s string, f func(rune) bool) iter.Seq[string] {
	return func(yield func(string) bool) {
		runes := []rune(s)
		start := -1
		for i, r := range runes {
			if f(r) {
				if start >= 0 {
					if !yield(string(runes[start:i])) {
						return
					}
					start = -1
				}
			} else if start < 0 {
				start = i
			}
		}
		if start >= 0 {
			yield(string(runes[start:]))
		}
	}
}
