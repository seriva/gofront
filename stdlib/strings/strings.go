//go:build gofront

//gofront:target both

// Package strings implements simple functions to manipulate UTF-8 encoded
// strings, written in Go over the real package's algorithms.  Only Builder
// is left to the backends.
//
// GoFront strings are host strings, so offsets, lengths and slice bounds
// count UTF-16 code units, not UTF-8 bytes: Index returns a value that
// s[i:] accepts, and strings with only ASCII characters behave exactly as
// in Go.  Runes are code points, and a lone surrogate reads as RuneError.
// The search, split, join, replace, case and trim functions keep host
// fast paths as natives that give the results the Go bodies give.
package strings

import (
	"iter"
	"unicode"
	"unicode/utf8"
)

// isSpace is unicode.IsSpace as a func(rune) bool (the checker types the
// unicode predicates over int).
func isSpace(r rune) bool {
	return unicode.IsSpace(int(r))
}

func upperRune(r rune) rune { return rune(unicode.ToUpper(int(r))) }
func lowerRune(r rune) rune { return rune(unicode.ToLower(int(r))) }

// validRune reports whether r is a code point a string can hold.
func validRune(r rune) bool {
	return r >= 0 && r <= 0x10FFFF && (r < 0xD800 || r > 0xDFFF)
}

// Clone returns a fresh copy of s.  Strings are immutable values here, so
// the copy is s itself.
func Clone(s string) string {
	return s
}

// Compare returns an integer comparing two strings lexicographically.
// The result will be 0 if a == b, -1 if a < b, and +1 if a > b.
func Compare(a, b string) int {
	if a == b {
		return 0
	}
	if a < b {
		return -1
	}
	return +1
}

// ── Search ────────────────────────────────────────────────────

// Index returns the index of the first instance of substr in s, or -1 if
// substr is not present in s.
//
//gofront:native strings.Index
func Index(s, substr string) int {
	n := len(substr)
	for i := 0; i+n <= len(s); i++ {
		if s[i:i+n] == substr {
			return i
		}
	}
	return -1
}

// LastIndex returns the index of the last instance of substr in s, or -1 if
// substr is not present in s.
//
//gofront:native strings.LastIndex
func LastIndex(s, substr string) int {
	n := len(substr)
	for i := len(s) - n; i >= 0; i-- {
		if s[i:i+n] == substr {
			return i
		}
	}
	return -1
}

// IndexByte returns the index of the first instance of c in s, or -1 if c
// is not present in s.
//
//gofront:native strings.IndexByte
func IndexByte(s string, c byte) int {
	return Index(s, string(rune(c)))
}

// LastIndexByte returns the index of the last instance of c in s, or -1 if
// c is not present in s.
//
//gofront:native strings.LastIndexByte
func LastIndexByte(s string, c byte) int {
	return LastIndex(s, string(rune(c)))
}

// IndexRune returns the index of the first instance of the Unicode code
// point r, or -1 if rune is not present in s.
// If r is utf8.RuneError, it returns the first instance of U+FFFD.
// If r is not a valid code point, IndexRune returns -1.
//
//gofront:native strings.IndexRune
func IndexRune(s string, r rune) int {
	if !validRune(r) {
		return -1
	}
	return Index(s, string(r))
}

// IndexAny returns the index of the first instance of any Unicode code point
// from chars in s, or -1 if no Unicode code point from chars is present in s.
//
//gofront:native strings.IndexAny
func IndexAny(s, chars string) int {
	m := -1
	for _, c := range chars {
		if i := IndexRune(s, c); i >= 0 && (m < 0 || i < m) {
			m = i
		}
	}
	return m
}

// LastIndexAny returns the index of the last instance of any Unicode code
// point from chars in s, or -1 if no Unicode code point from chars is
// present in s.
//
//gofront:native strings.LastIndexAny
func LastIndexAny(s, chars string) int {
	m := -1
	for _, c := range chars {
		if !validRune(c) {
			continue
		}
		if i := LastIndex(s, string(c)); i > m {
			m = i
		}
	}
	return m
}

// Contains reports whether substr is within s.
//
//gofront:native strings.Contains
func Contains(s, substr string) bool {
	return Index(s, substr) >= 0
}

// ContainsAny reports whether any Unicode code points in chars are within s.
//
//gofront:native strings.ContainsAny
func ContainsAny(s, chars string) bool {
	return IndexAny(s, chars) >= 0
}

// ContainsRune reports whether the Unicode code point r is within s.
//
//gofront:native strings.ContainsRune
func ContainsRune(s string, r rune) bool {
	return IndexRune(s, r) >= 0
}

// ContainsFunc reports whether any Unicode code points in s satisfy f(c).
func ContainsFunc(s string, f func(rune) bool) bool {
	return IndexFunc(s, f) >= 0
}

// HasPrefix reports whether the string s begins with prefix.
//
//gofront:native strings.HasPrefix
func HasPrefix(s, prefix string) bool {
	return len(s) >= len(prefix) && s[:len(prefix)] == prefix
}

// HasSuffix reports whether the string s ends with suffix.
//
//gofront:native strings.HasSuffix
func HasSuffix(s, suffix string) bool {
	return len(s) >= len(suffix) && s[len(s)-len(suffix):] == suffix
}

// Count counts the number of non-overlapping instances of substr in s.
// If substr is an empty string, Count returns 1 + the number of Unicode
// code points in s.
//
//gofront:native strings.Count
func Count(s, substr string) int {
	if len(substr) == 0 {
		return utf8.RuneCountInString(s) + 1
	}
	n := 0
	for {
		i := Index(s, substr)
		if i == -1 {
			return n
		}
		n++
		s = s[i+len(substr):]
	}
}

// ── Split, join, repeat and replace ───────────────────────────

// explode splits s into a slice of single-code-point strings, up to n of
// them (the last holds the rest of s) when n > 0.
func explode(s string, n int) []string {
	runes := []rune(s)
	l := len(runes)
	if n < 0 || n > l {
		n = l
	}
	a := make([]string, n)
	for i := 0; i < n-1; i++ {
		a[i] = string(runes[i])
	}
	if n > 0 {
		a[n-1] = string(runes[n-1:])
	}
	return a
}

// Generic split: splits after each instance of sep, including sepSave
// units of sep in the subarrays.
func genSplit(s, sep string, sepSave, n int) []string {
	if n == 0 {
		return nil
	}
	if sep == "" {
		return explode(s, n)
	}
	if n < 0 {
		n = Count(s, sep) + 1
	}
	if n > len(s)+1 {
		n = len(s) + 1
	}
	a := make([]string, n)
	n--
	i := 0
	for i < n {
		m := Index(s, sep)
		if m < 0 {
			break
		}
		a[i] = s[:m+sepSave]
		s = s[m+len(sep):]
		i++
	}
	a[i] = s
	return a[:i+1]
}

// SplitN slices s into substrings separated by sep and returns a slice of
// the substrings between those separators.
//
// The count determines the number of substrings to return:
//   - n > 0: at most n substrings; the last substring will be the unsplit remainder;
//   - n == 0: the result is nil (zero substrings);
//   - n < 0: all substrings.
func SplitN(s, sep string, n int) []string { return genSplit(s, sep, 0, n) }

// SplitAfterN slices s into substrings after each instance of sep and
// returns a slice of those substrings.
func SplitAfterN(s, sep string, n int) []string {
	return genSplit(s, sep, len(sep), n)
}

// Split slices s into all substrings separated by sep and returns a slice of
// the substrings between those separators.
//
// If s does not contain sep and sep is not empty, Split returns a
// slice of length 1 whose only element is s.
//
// If sep is empty, Split splits after each UTF-8 sequence.
//
//gofront:native strings.Split
func Split(s, sep string) []string { return genSplit(s, sep, 0, -1) }

// SplitAfter slices s into all substrings after each instance of sep and
// returns a slice of those substrings.
func SplitAfter(s, sep string) []string {
	return genSplit(s, sep, len(sep), -1)
}

// Join concatenates the elements of its first argument to create a single
// string. The separator string sep is placed between elements in the
// resulting string.
//
//gofront:native strings.Join
func Join(elems []string, sep string) string {
	switch len(elems) {
	case 0:
		return ""
	case 1:
		return elems[0]
	}
	var b Builder
	b.WriteString(elems[0])
	for _, s := range elems[1:] {
		b.WriteString(sep)
		b.WriteString(s)
	}
	return b.String()
}

// Repeat returns a new string consisting of count copies of the string s.
//
// It panics if count is negative.
//
//gofront:native strings.Repeat
func Repeat(s string, count int) string {
	if count < 0 {
		panic("strings: negative Repeat count")
	}
	var b Builder
	for i := 0; i < count; i++ {
		b.WriteString(s)
	}
	return b.String()
}

// Replace returns a copy of the string s with the first n
// non-overlapping instances of old replaced by new.
// If old is empty, it matches at the beginning of the string
// and after each UTF-8 sequence, yielding up to k+1 replacements
// for a k-rune string.
// If n < 0, there is no limit on the number of replacements.
//
//gofront:native strings.Replace
func Replace(s, old, new string, n int) string {
	if old == new || n == 0 {
		return s
	}
	if m := Count(s, old); m == 0 {
		return s
	} else if n < 0 || m < n {
		n = m
	}
	var b Builder
	start := 0
	for i := 0; i < n; i++ {
		j := start
		if len(old) == 0 {
			if i > 0 {
				_, wid := utf8.DecodeRuneInString(s[start:])
				j += wid
			}
		} else {
			j += Index(s[start:], old)
		}
		b.WriteString(s[start:j])
		b.WriteString(new)
		start = j + len(old)
	}
	b.WriteString(s[start:])
	return b.String()
}

// ReplaceAll returns a copy of the string s with all
// non-overlapping instances of old replaced by new.
// If old is empty, it matches at the beginning of the string
// and after each UTF-8 sequence, yielding up to k+1 replacements
// for a k-rune string.
//
//gofront:native strings.ReplaceAll
func ReplaceAll(s, old, new string) string {
	return Replace(s, old, new, -1)
}

// Cut slices s around the first instance of sep,
// returning the text before and after sep.
// The found result reports whether sep appears in s.
// If sep does not appear in s, cut returns s, "", false.
func Cut(s, sep string) (before, after string, found bool) {
	if i := Index(s, sep); i >= 0 {
		return s[:i], s[i+len(sep):], true
	}
	return s, "", false
}

// CutPrefix returns s without the provided leading prefix string
// and reports whether it found the prefix.
// If s doesn't start with prefix, CutPrefix returns s, false.
// If prefix is the empty string, CutPrefix returns s, true.
func CutPrefix(s, prefix string) (after string, found bool) {
	if !HasPrefix(s, prefix) {
		return s, false
	}
	return s[len(prefix):], true
}

// CutSuffix returns s without the provided ending suffix string
// and reports whether it found the suffix.
// If s doesn't end with suffix, CutSuffix returns s, false.
// If suffix is the empty string, CutSuffix returns s, true.
func CutSuffix(s, suffix string) (before string, found bool) {
	if !HasSuffix(s, suffix) {
		return s, false
	}
	return s[:len(s)-len(suffix)], true
}

// Fields splits the string s around each instance of one or more
// consecutive white space characters, as defined by unicode.IsSpace,
// returning a slice of substrings of s or an empty slice if s contains only
// white space.
//
//gofront:native strings.Fields
func Fields(s string) []string {
	return FieldsFunc(s, isSpace)
}

// FieldsFunc splits the string s at each run of Unicode code points c
// satisfying f(c) and returns an array of slices of s.  If all code points
// in s satisfy f(c) or the string is empty, an empty slice is returned.
func FieldsFunc(s string, f func(rune) bool) []string {
	fields := make([]string, 0, 8)
	start := -1
	for i := 0; i < len(s); {
		r, size := utf8.DecodeRuneInString(s[i:])
		if f(r) {
			if start >= 0 {
				fields = append(fields, s[start:i])
				start = -1
			}
		} else if start < 0 {
			start = i
		}
		i += size
	}
	if start >= 0 {
		fields = append(fields, s[start:])
	}
	return fields
}

// ── Case mapping, folding and mapping ─────────────────────────

// Map returns a copy of the string s with all its characters modified
// according to the mapping function. If mapping returns a negative value, the
// character is dropped from the string with no replacement.
func Map(mapping func(rune) rune, s string) string {
	var b Builder
	for _, c := range s {
		r := mapping(c)
		if r >= 0 {
			b.WriteRune(r)
		}
	}
	return b.String()
}

// ToUpper returns s with all Unicode letters mapped to their upper case.
//
//gofront:native strings.ToUpper
func ToUpper(s string) string { return Map(upperRune, s) }

// ToLower returns s with all Unicode letters mapped to their lower case.
//
//gofront:native strings.ToLower
func ToLower(s string) string { return Map(lowerRune, s) }

// ToTitle returns a copy of the string s with all Unicode letters mapped to
// their Unicode title case.
func ToTitle(s string) string { return Map(unicode.ToTitle, s) }

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

// Title returns a copy of the string s with all Unicode letters that begin
// words mapped to their Unicode title case.
//
// Deprecated: The rule Title uses for word boundaries does not handle Unicode
// punctuation properly.
func Title(s string) string {
	prev := rune(' ')
	return Map(
		func(r rune) rune {
			if isSeparator(prev) {
				prev = r
				return unicode.ToTitle(r)
			}
			prev = r
			return r
		},
		s)
}

// EqualFold reports whether s and t, interpreted as UTF-8 strings,
// are equal under simple Unicode case-folding, which is a more general
// form of case-insensitivity.
func EqualFold(s, t string) bool {
	for len(s) != 0 && len(t) != 0 {
		sr, ssize := utf8.DecodeRuneInString(s)
		tr, tsize := utf8.DecodeRuneInString(t)
		s, t = s[ssize:], t[tsize:]
		if tr == sr {
			continue
		}
		if tr < sr {
			tr, sr = sr, tr
		}
		if tr < 0x80 {
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

// ToValidUTF8 returns a copy of the string s with each run of invalid UTF-8
// byte sequences replaced by the replacement string, which may be empty.
// A lone surrogate is the invalid sequence a GoFront string can hold.
func ToValidUTF8(s, replacement string) string {
	var b Builder
	invalid := false
	for i := 0; i < len(s); {
		_, size := utf8.DecodeRuneInString(s[i:])
		if size == 1 && int(s[i]) >= 0xD800 && int(s[i]) <= 0xDFFF {
			if !invalid {
				invalid = true
				b.WriteString(replacement)
			}
			i += size
			continue
		}
		invalid = false
		b.WriteString(s[i : i+size])
		i += size
	}
	return b.String()
}

// ── Trim ──────────────────────────────────────────────────────

// IndexFunc returns the index into s of the first Unicode
// code point satisfying f(c), or -1 if none do.
func IndexFunc(s string, f func(rune) bool) int {
	return indexFunc(s, f, true)
}

// LastIndexFunc returns the index into s of the last
// Unicode code point satisfying f(c), or -1 if none do.
func LastIndexFunc(s string, f func(rune) bool) int {
	return lastIndexFunc(s, f, true)
}

func indexFunc(s string, f func(rune) bool, truth bool) int {
	for i := 0; i < len(s); {
		r, size := utf8.DecodeRuneInString(s[i:])
		if f(r) == truth {
			return i
		}
		i += size
	}
	return -1
}

func lastIndexFunc(s string, f func(rune) bool, truth bool) int {
	for i := len(s); i > 0; {
		r, size := utf8.DecodeLastRuneInString(s[:i])
		i -= size
		if f(r) == truth {
			return i
		}
	}
	return -1
}

// inCutset reports whether r is one of the code points of cutset.
func inCutset(cutset string, r rune) bool {
	for _, c := range cutset {
		if c == r {
			return true
		}
	}
	return false
}

// Trim returns a slice of the string s with all leading and
// trailing Unicode code points contained in cutset removed.
//
//gofront:native strings.Trim
func Trim(s, cutset string) string {
	if s == "" || cutset == "" {
		return s
	}
	in := func(r rune) bool { return inCutset(cutset, r) }
	return TrimFunc(s, in)
}

// TrimLeft returns a slice of the string s with all leading
// Unicode code points contained in cutset removed.
//
// To remove a prefix, use TrimPrefix instead.
//
//gofront:native strings.TrimLeft
func TrimLeft(s, cutset string) string {
	if s == "" || cutset == "" {
		return s
	}
	return TrimLeftFunc(s, func(r rune) bool { return inCutset(cutset, r) })
}

// TrimRight returns a slice of the string s, with all trailing
// Unicode code points contained in cutset removed.
//
// To remove a suffix, use TrimSuffix instead.
//
//gofront:native strings.TrimRight
func TrimRight(s, cutset string) string {
	if s == "" || cutset == "" {
		return s
	}
	return TrimRightFunc(s, func(r rune) bool { return inCutset(cutset, r) })
}

// TrimFunc returns a slice of the string s with all leading
// and trailing Unicode code points c satisfying f(c) removed.
func TrimFunc(s string, f func(rune) bool) string {
	return TrimRightFunc(TrimLeftFunc(s, f), f)
}

// TrimLeftFunc returns a slice of the string s with all leading
// Unicode code points c satisfying f(c) removed.
func TrimLeftFunc(s string, f func(rune) bool) string {
	i := indexFunc(s, f, false)
	if i == -1 {
		return ""
	}
	return s[i:]
}

// TrimRightFunc returns a slice of the string s with all trailing
// Unicode code points c satisfying f(c) removed.
func TrimRightFunc(s string, f func(rune) bool) string {
	i := lastIndexFunc(s, f, false)
	if i >= 0 {
		_, wid := utf8.DecodeRuneInString(s[i:])
		i += wid
	} else {
		i++
	}
	return s[0:i]
}

// TrimSpace returns a slice of the string s, with all leading
// and trailing white space removed, as defined by Unicode.
//
//gofront:native strings.TrimSpace
func TrimSpace(s string) string { return TrimFunc(s, isSpace) }

// TrimPrefix returns s without the provided leading prefix string.
// If s doesn't start with prefix, s is returned unchanged.
//
//gofront:native strings.TrimPrefix
func TrimPrefix(s, prefix string) string {
	if HasPrefix(s, prefix) {
		return s[len(prefix):]
	}
	return s
}

// TrimSuffix returns s without the provided trailing suffix string.
// If s doesn't end with suffix, s is returned unchanged.
//
//gofront:native strings.TrimSuffix
func TrimSuffix(s, suffix string) string {
	if HasSuffix(s, suffix) {
		return s[:len(s)-len(suffix)]
	}
	return s
}

// ── Iterators ─────────────────────────────────────────────────

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
// units of sep to include in the results (none or all).
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
