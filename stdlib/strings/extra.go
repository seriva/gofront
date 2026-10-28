//go:build gofront

//gofront:target both

// Overlay on the emitter-backed strings package: small members written in Go
// and merged into the strings namespace.
package strings

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

// ContainsFunc reports whether any Unicode code points in s satisfy f(c).
func ContainsFunc(s string, f func(rune) bool) bool {
	for _, r := range s {
		if f(r) {
			return true
		}
	}
	return false
}
