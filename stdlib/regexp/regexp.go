//go:build gofront

//gofront:target js

// Package regexp is backed by the host's RegExp engine, so patterns use
// JavaScript syntax and indexes count UTF-16 units. A pattern may start with
// inline flags such as (?i). It is only available in js packages.
package regexp

import "errors"

// Regexp is the representation of a compiled regular expression.
type Regexp struct {
	src string
	re  any
}

// inlineFlags splits a leading "(?flags)" group (flags from "gimsuy") off the
// pattern.
func inlineFlags(expr string) (pattern, flags string) {
	if len(expr) < 4 || expr[0] != '(' || expr[1] != '?' {
		return expr, ""
	}
	for i := 2; i < len(expr); i++ {
		switch expr[i] {
		case 'g', 'i', 'm', 's', 'u', 'y':
		case ')':
			if i == 2 {
				return expr, ""
			}
			return expr[i+1:], expr[2:i]
		default:
			return expr, ""
		}
	}
	return expr, ""
}

// Compile parses a regular expression and returns, if successful, a Regexp
// object that can be used to match against text.
func Compile(expr string) (re *Regexp, err error) {
	defer func() {
		if r := recover(); r != nil {
			re = nil
			err = errors.New("error parsing regexp: " + errorText(r))
		}
	}()
	pattern, flags := inlineFlags(expr)
	return &Regexp{src: expr, re: RegExp(pattern, flags)}, nil
}

func errorText(r any) string {
	if s, ok := r.(string); ok {
		return s
	}
	if e, ok := r.(error); ok {
		return e.Error()
	}
	return String(r.message).(string)
}

// MustCompile is like Compile but panics if the expression cannot be parsed.
func MustCompile(expr string) *Regexp {
	re, err := Compile(expr)
	if err != nil {
		panic("regexp: Compile(`" + expr + "`): " + err.Error())
	}
	return re
}

// MatchString reports whether the string s contains any match of the regular
// expression pattern.
func MatchString(pattern string, s string) (matched bool, err error) {
	re, err := Compile(pattern)
	if err != nil {
		return false, err
	}
	return re.MatchString(s), nil
}

// QuoteMeta returns a string that escapes all regular expression
// metacharacters inside the argument text.
func QuoteMeta(s string) string {
	var b []byte
	for i := 0; i < len(s); i++ {
		switch s[i] {
		case '\\', '.', '+', '*', '?', '(', ')', '|', '[', ']', '{', '}', '^', '$':
			b = append(b, '\\')
		}
		b = append(b, s[i])
	}
	return string(b)
}

// String returns the source text used to compile the regular expression.
func (re *Regexp) String() string {
	return re.src
}

// global returns a copy of the expression that matches every occurrence.
func (re *Regexp) global() any {
	flags := re.re.flags.(string)
	if !re.re.flags.includes("g").(bool) {
		flags += "g"
	}
	return RegExp(re.re.source, flags)
}

func text(v any) string {
	if v == nil {
		return ""
	}
	return v.(string)
}

func groups(m any) []string {
	items := m.([]any)
	out := make([]string, len(items))
	for i, v := range items {
		out[i] = text(v)
	}
	return out
}

// matches returns the match arrays of up to n occurrences (all when n < 0).
func (re *Regexp) matches(s string, n int) []any {
	var out []any
	if n == 0 {
		return out
	}
	all := Array.from(any(s).matchAll(re.global())).([]any)
	for _, m := range all {
		out = append(out, m)
		if n > 0 && len(out) >= n {
			break
		}
	}
	return out
}

// MatchString reports whether the string s contains any match of the regular
// expression re.
func (re *Regexp) MatchString(s string) bool {
	return re.re.test(s).(bool)
}

// FindString returns a string holding the text of the leftmost match in s of
// the regular expression, or "" if there is no match.
func (re *Regexp) FindString(s string) string {
	m := re.re.exec(s)
	if m == nil {
		return ""
	}
	return text(m.([]any)[0])
}

// FindStringIndex returns a two-element slice of integers defining the
// location of the leftmost match in s of the regular expression, or nil if
// there is no match.
func (re *Regexp) FindStringIndex(s string) []int {
	m := re.re.exec(s)
	if m == nil {
		return nil
	}
	start := m.index.(int)
	return []int{start, start + m.([]any)[0].length.(int)}
}

// FindAllString returns a slice of all successive matches of the expression;
// a negative n means all matches.
func (re *Regexp) FindAllString(s string, n int) []string {
	out := []string{}
	for _, m := range re.matches(s, n) {
		out = append(out, text(m.([]any)[0]))
	}
	return out
}

// FindStringSubmatch returns a slice of strings holding the text of the
// leftmost match and of its subexpressions.
func (re *Regexp) FindStringSubmatch(s string) []string {
	m := re.re.exec(s)
	if m == nil {
		return []string{}
	}
	return groups(m)
}

// FindAllStringSubmatch is the 'All' version of FindStringSubmatch.
func (re *Regexp) FindAllStringSubmatch(s string, n int) [][]string {
	out := [][]string{}
	for _, m := range re.matches(s, n) {
		out = append(out, groups(m))
	}
	return out
}

// ReplaceAllString returns a copy of src, replacing matches of the Regexp
// with the replacement string repl. Inside repl, $1 and $& refer to the
// match as in JavaScript.
func (re *Regexp) ReplaceAllString(src, repl string) string {
	return any(src).replaceAll(re.global(), repl).(string)
}

// ReplaceAllLiteralString returns a copy of src, replacing matches of the
// Regexp with the replacement string repl, without expanding $.
func (re *Regexp) ReplaceAllLiteralString(src, repl string) string {
	return re.ReplaceAllStringFunc(src, func(string) string { return repl })
}

// ReplaceAllStringFunc returns a copy of src in which all matches of the
// Regexp have been replaced by the return value of function repl applied to
// the matched substring.
func (re *Regexp) ReplaceAllStringFunc(src string, repl func(string) string) string {
	return any(src).replaceAll(re.global(), func(m string) string { return repl(m) }).(string)
}

// Split slices s into substrings separated by the expression. Text captured
// by groups is included, as in JavaScript. A non-negative n keeps at most n
// substrings.
func (re *Regexp) Split(s string, n int) []string {
	parts := Array.from(any(s).split(re.re)).([]any)
	out := make([]string, 0, len(parts))
	for _, p := range parts {
		if n >= 0 && len(out) >= n {
			break
		}
		out = append(out, text(p))
	}
	return out
}
