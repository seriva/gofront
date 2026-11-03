//go:build gofront

//gofront:target both

// Overlay on the emitter-backed strings package: Replacer written in Go.
// Replacements run in the order they appear in the target string without
// overlapping, and the old strings are tried in argument order, with an
// empty old string never matching twice at the same position, as in Go's
// generic replacer.
package strings

import "io"

// Replacer replaces a list of strings with replacements.
// It is safe for concurrent use by multiple goroutines.
type Replacer struct {
	oldnew []string
}

// NewReplacer returns a new Replacer from a list of old, new string
// pairs. It panics if given an odd number of arguments.
func NewReplacer(oldnew ...string) *Replacer {
	if len(oldnew)%2 == 1 {
		panic("strings.NewReplacer: odd argument count")
	}
	return &Replacer{oldnew: append([]string(nil), oldnew...)}
}

// match returns the replacement chosen at the start of s and the length of
// the old string it replaces; the first old string in argument order that is
// a prefix of s wins, and an empty one is skipped when skipEmpty is set.
func (r *Replacer) match(s string, skipEmpty bool) (val string, keylen int, ok bool) {
	for i := 0; i < len(r.oldnew); i += 2 {
		old := r.oldnew[i]
		if skipEmpty && len(old) == 0 {
			continue
		}
		if len(old) <= len(s) && s[:len(old)] == old {
			return r.oldnew[i+1], len(old), true
		}
	}
	return "", 0, false
}

// Replace returns a copy of s with all replacements performed.
func (r *Replacer) Replace(s string) string {
	var out []byte
	changed := false
	last := 0
	prevMatchEmpty := false
	for i := 0; i <= len(s); {
		val, keylen, ok := r.match(s[i:], prevMatchEmpty)
		prevMatchEmpty = ok && keylen == 0
		if ok {
			changed = true
			out = append(out, s[last:i]...)
			out = append(out, val...)
			i += keylen
			last = i
			continue
		}
		i++
	}
	if !changed {
		return s
	}
	out = append(out, s[last:]...)
	return string(out)
}

// WriteString writes s to w with all replacements performed.
func (r *Replacer) WriteString(w io.Writer, s string) (n int, err error) {
	last := 0
	prevMatchEmpty := false
	for i := 0; i <= len(s); {
		val, keylen, ok := r.match(s[i:], prevMatchEmpty)
		prevMatchEmpty = ok && keylen == 0
		if ok {
			var wn int
			wn, err = io.WriteString(w, s[last:i])
			n += wn
			if err != nil {
				return
			}
			wn, err = io.WriteString(w, val)
			n += wn
			if err != nil {
				return
			}
			i += keylen
			last = i
			continue
		}
		i++
	}
	if last != len(s) {
		var wn int
		wn, err = io.WriteString(w, s[last:])
		n += wn
	}
	return
}
