//go:build gofront

//gofront:target both

// Package bytes implements functions for the manipulation of byte slices,
// written in Go over the real package's algorithms.  Offsets are byte
// offsets and UTF-8 is decoded as Go does, so an invalid sequence reads as
// (RuneError, 1).  Like Go's, the slices that the split and sequence
// functions return alias the input and have their capacity clipped.
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
			i := Index(s, sep)
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


// IndexByte returns the index of the first instance of c in b, or -1 if c is
// not present in b.
//
//gofront:native bytes.IndexByte
func IndexByte(b []byte, c byte) int {
	for i, x := range b {
		if x == c {
			return i
		}
	}
	return -1
}

// Equal reports whether a and b are the same length and contain the same
// bytes. A nil argument is equivalent to an empty slice.
//
//gofront:native bytes.Equal
func Equal(a, b []byte) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}

// Index returns the index of the first instance of sep in s, or -1 if sep is
// not present in s.
func Index(s, sep []byte) int {
	n := len(sep)
	switch {
	case n == 0:
		return 0
	case n == 1:
		return IndexByte(s, sep[0])
	case n == len(s):
		if Equal(sep, s) {
			return 0
		}
		return -1
	case n > len(s):
		return -1
	}
	c0 := sep[0]
	for i := 0; i+n <= len(s); i++ {
		j := IndexByte(s[i:len(s)-n+1], c0)
		if j < 0 {
			return -1
		}
		i += j
		if Equal(s[i:i+n], sep) {
			return i
		}
	}
	return -1
}

// LastIndex returns the index of the last instance of sep in s, or -1 if sep
// is not present in s.
func LastIndex(s, sep []byte) int {
	n := len(sep)
	if n == 0 {
		return len(s)
	}
	for i := len(s) - n; i >= 0; i-- {
		if s[i] == sep[0] && Equal(s[i:i+n], sep) {
			return i
		}
	}
	return -1
}

// LastIndexByte returns the index of the last instance of c in s, or -1 if c
// is not present in s.
func LastIndexByte(s []byte, c byte) int {
	for i := len(s) - 1; i >= 0; i-- {
		if s[i] == c {
			return i
		}
	}
	return -1
}

// Contains reports whether subslice is within b.
func Contains(b, subslice []byte) bool {
	return Index(b, subslice) != -1
}

// ContainsAny reports whether any of the UTF-8-encoded code points in chars
// are within b.
func ContainsAny(b []byte, chars string) bool {
	return IndexAny(b, chars) >= 0
}

// ContainsRune reports whether the rune is contained in the UTF-8-encoded
// byte slice b.
func ContainsRune(b []byte, r rune) bool {
	return IndexRune(b, r) >= 0
}

// Count counts the number of non-overlapping instances of sep in s.
// If sep is an empty slice, Count returns 1 + the number of UTF-8-encoded
// code points in s.
func Count(s, sep []byte) int {
	if len(sep) == 0 {
		return runeCount(s) + 1
	}
	return countSep(s, sep)
}

// HasPrefix reports whether the byte slice s begins with prefix.
func HasPrefix(s, prefix []byte) bool {
	return len(s) >= len(prefix) && Equal(s[:len(prefix)], prefix)
}

// HasSuffix reports whether the byte slice s ends with suffix.
func HasSuffix(s, suffix []byte) bool {
	return len(s) >= len(suffix) && Equal(s[len(s)-len(suffix):], suffix)
}

// Clone returns a copy of b[:len(b)].
// The result may have additional unused capacity.
// Clone(nil) returns nil.
func Clone(b []byte) []byte {
	if b == nil {
		return nil
	}
	return append([]byte{}, b...)
}

// Cut slices s around the first instance of sep,
// returning the text before and after sep.
// The found result reports whether sep appears in s.
// If sep does not appear in s, cut returns s, nil, false.
func Cut(s, sep []byte) (before, after []byte, found bool) {
	if i := Index(s, sep); i >= 0 {
		return s[:i], s[i+len(sep):], true
	}
	return s, nil, false
}

// Repeat returns a new byte slice consisting of count copies of b.
// It panics if count is negative.
func Repeat(b []byte, count int) []byte {
	if count < 0 {
		panic("bytes: negative Repeat count")
	}
	nb := make([]byte, 0, len(b)*count)
	for i := 0; i < count; i++ {
		nb = append(nb, b...)
	}
	return nb
}

// Split slices s into all subslices separated by sep and returns a slice of
// the subslices between those separators.
// If sep is empty, Split splits after each UTF-8 sequence.
// It is equivalent to SplitN with a count of -1.
func Split(s, sep []byte) [][]byte { return genSplit(s, sep, 0, -1) }

// SplitN slices s into subslices separated by sep and returns a slice of
// the subslices between those separators.
// The count determines the number of subslices to return:
//   - n > 0: at most n subslices; the last subslice will be the unsplit remainder;
//   - n == 0: the result is nil (zero subslices);
//   - n < 0: all subslices.
func SplitN(s, sep []byte, n int) [][]byte { return genSplit(s, sep, 0, n) }

// Join concatenates the elements of s to create a new byte slice. The separator
// sep is placed between elements in the resulting slice.
func Join(s [][]byte, sep []byte) []byte {
	if len(s) == 0 {
		return []byte{}
	}
	if len(s) == 1 {
		return append([]byte(nil), s[0]...)
	}
	n := len(sep) * (len(s) - 1)
	for _, v := range s {
		n += len(v)
	}
	b := make([]byte, 0, n)
	b = append(b, s[0]...)
	for _, v := range s[1:] {
		b = append(b, sep...)
		b = append(b, v...)
	}
	return b
}

// span is the byte range of one field.
type span struct {
	start int
	end   int
}

// FieldsFunc interprets s as a sequence of UTF-8-encoded code points.
// It splits the slice s at each run of code points c satisfying f(c) and
// returns a slice of subslices of s. If all code points in s satisfy f(c), or
// len(s) == 0, an empty slice is returned.
func FieldsFunc(s []byte, f func(rune) bool) [][]byte {
	spans := make([]span, 0, 32)
	start := -1
	for i := 0; i < len(s); {
		size := 1
		r := rune(s[i])
		if r >= runeSelf {
			r, size = decodeRune(s[i:])
		}
		if f(r) {
			if start >= 0 {
				spans = append(spans, span{start, i})
				start = -1
			}
		} else if start < 0 {
			start = i
		}
		i += size
	}
	if start >= 0 {
		spans = append(spans, span{start, len(s)})
	}
	a := make([][]byte, len(spans))
	for i, sp := range spans {
		a[i] = s[sp.start:sp.end:sp.end]
	}
	return a
}

// Fields interprets s as a sequence of UTF-8-encoded code points.
// It splits the slice s around each instance of one or more consecutive white
// space characters, as defined by unicode.IsSpace, returning a slice of
// subslices of s or an empty slice if s contains only white space.
func Fields(s []byte) [][]byte { return FieldsFunc(s, isSpace) }

// Map returns a copy of the byte slice s with all its characters modified
// according to the mapping function. If mapping returns a negative value, the
// character is dropped from the byte slice with no replacement. The characters
// in s and the output are interpreted as UTF-8-encoded code points.
func Map(mapping func(r rune) rune, s []byte) []byte {
	b := make([]byte, 0, len(s))
	for i := 0; i < len(s); {
		wid := 1
		r := rune(s[i])
		if r >= runeSelf {
			r, wid = decodeRune(s[i:])
		}
		r = mapping(r)
		if r >= 0 {
			b = appendRune(b, r)
		}
		i += wid
	}
	return b
}

func upperRune(r rune) rune { return rune(unicode.ToUpper(int(r))) }
func lowerRune(r rune) rune { return rune(unicode.ToLower(int(r))) }

// ToUpper returns a copy of s with all Unicode letters mapped to their
// upper case.
func ToUpper(s []byte) []byte { return Map(upperRune, s) }

// ToLower returns a copy of s with all Unicode letters mapped to their
// lower case.
func ToLower(s []byte) []byte { return Map(lowerRune, s) }

// ToTitle treats s as UTF-8-encoded bytes and returns a copy with all the
// Unicode letters mapped to their title case.
func ToTitle(s []byte) []byte { return Map(unicode.ToTitle, s) }

// ToValidUTF8 treats s as UTF-8-encoded bytes and returns a copy with each
// run of bytes representing invalid UTF-8 replaced with the bytes in
// replacement, which may be empty.
func ToValidUTF8(s, replacement []byte) []byte {
	b := make([]byte, 0, len(s)+len(replacement))
	invalid := false
	for i := 0; i < len(s); {
		c := s[i]
		if c < runeSelf {
			i++
			invalid = false
			b = append(b, c)
			continue
		}
		_, wid := decodeRune(s[i:])
		if wid == 1 {
			i++
			if !invalid {
				invalid = true
				b = append(b, replacement...)
			}
			continue
		}
		invalid = false
		b = append(b, s[i:i+wid]...)
		i += wid
	}
	return b
}

// Replace returns a copy of the slice s with the first n
// non-overlapping instances of old replaced by new.
// If old is empty, it matches at the beginning of the slice
// and after each UTF-8 sequence, yielding up to k+1 replacements
// for a k-rune slice.
// If n < 0, there is no limit on the number of replacements.
func Replace(s, old, new []byte, n int) []byte {
	m := 0
	if n != 0 {
		m = Count(s, old)
	}
	if m == 0 {
		return append([]byte(nil), s...)
	}
	if n < 0 || m < n {
		n = m
	}
	t := make([]byte, 0, len(s)+n*(len(new)-len(old)))
	start := 0
	for i := 0; i < n; i++ {
		j := start
		if len(old) == 0 {
			if i > 0 {
				_, wid := decodeRune(s[start:])
				j += wid
			}
		} else {
			j += Index(s[start:], old)
		}
		t = append(t, s[start:j]...)
		t = append(t, new...)
		start = j + len(old)
	}
	t = append(t, s[start:]...)
	return t
}

// ReplaceAll returns a copy of the slice s with all
// non-overlapping instances of old replaced by new.
// If old is empty, it matches at the beginning of the slice
// and after each UTF-8 sequence, yielding up to k+1 replacements
// for a k-rune slice.
func ReplaceAll(s, old, new []byte) []byte {
	return Replace(s, old, new, -1)
}

// TrimFunc returns a subslice of s by slicing off all leading and trailing
// UTF-8-encoded code points c that satisfy f(c).
func TrimFunc(s []byte, f func(r rune) bool) []byte {
	return TrimRightFunc(TrimLeftFunc(s, f), f)
}

// Trim returns a subslice of s by slicing off all leading and
// trailing UTF-8-encoded code points contained in cutset.
func Trim(s []byte, cutset string) []byte {
	if len(s) == 0 {
		return nil
	}
	if cutset == "" {
		return s
	}
	in := func(r rune) bool { return containsRuneIn(cutset, r) }
	return TrimLeftFunc(TrimRightFunc(s, in), in)
}

// TrimLeft returns a subslice of s by slicing off all leading
// UTF-8-encoded code points contained in cutset.
func TrimLeft(s []byte, cutset string) []byte {
	if len(s) == 0 {
		return nil
	}
	if cutset == "" {
		return s
	}
	return TrimLeftFunc(s, func(r rune) bool { return containsRuneIn(cutset, r) })
}

// TrimRight returns a subslice of s by slicing off all trailing
// UTF-8-encoded code points that are contained in cutset.
func TrimRight(s []byte, cutset string) []byte {
	if len(s) == 0 || cutset == "" {
		return s
	}
	return TrimRightFunc(s, func(r rune) bool { return containsRuneIn(cutset, r) })
}

// TrimSpace returns a subslice of s by slicing off all leading and
// trailing white space, as defined by Unicode.
func TrimSpace(s []byte) []byte { return TrimFunc(s, isSpace) }

// TrimPrefix returns s without the provided leading prefix string.
// If s doesn't start with prefix, s is returned unchanged.
func TrimPrefix(s, prefix []byte) []byte {
	if HasPrefix(s, prefix) {
		return s[len(prefix):]
	}
	return s
}

// TrimSuffix returns s without the provided trailing suffix string.
// If s doesn't end with suffix, s is returned unchanged.
func TrimSuffix(s, suffix []byte) []byte {
	if HasSuffix(s, suffix) {
		return s[:len(s)-len(suffix)]
	}
	return s
}

// Compare returns an integer comparing two byte slices lexicographically.
// The result will be 0 if a == b, -1 if a < b, and +1 if a > b.
// A nil argument is equivalent to an empty slice.
//
//gofront:native bytes.Compare
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
		return IndexByte(s, byte(r))
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
		i := Index(s, sep)
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
		m := Index(s, sep)
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
