// Copyright 2010 The Go Authors. All rights reserved.
// Use of this source code is governed by a BSD-style
// license that can be found in the LICENSE file.

//go:build gofront

//gofront:target both

package jsonrt

import (
	"encoding/base64"
	"errors"
	"math"
	"sort"
	"strconv"
	"unicode/utf8"
)

// An UnsupportedValueError is returned by Marshal when attempting to encode
// an unsupported value.
type UnsupportedValueError struct {
	Str string
}

func (e *UnsupportedValueError) Error() string {
	return "json: unsupported value: " + e.Str
}

// UnsupportedTypeError is returned by Marshal when attempting to encode an
// unsupported value type.
type UnsupportedTypeError struct {
	Type string
}

func (e *UnsupportedTypeError) Error() string {
	return "json: unsupported type: " + e.Type
}

// A MarshalerError represents an error from calling a MarshalJSON method.
type MarshalerError struct {
	Type       string
	Err        error
	sourceFunc string
}

func (e *MarshalerError) Error() string {
	srcFunc := e.sourceFunc
	if srcFunc == "" {
		srcFunc = "MarshalJSON"
	}
	return "json: error calling " + srcFunc + " for type " + e.Type + ": " + e.Err.Error()
}

func (e *MarshalerError) Unwrap() error { return e.Err }

// Enc is the state of one Marshal call: the output so far and the first
// error. After an error every method does nothing.
type Enc struct {
	B          []byte
	Err        error
	EscapeHTML bool
}

// NewEnc returns an encoder that escapes <, > and & like json.Marshal.
func NewEnc() *Enc {
	return &Enc{EscapeHTML: OptEscapeHTML}
}

// Result returns the encoded bytes, or the first error.
func (e *Enc) Result() ([]byte, error) {
	if e.Err != nil {
		return nil, e.Err
	}
	return e.B, nil
}

// Fail records the first error.
func (e *Enc) Fail(err error) {
	if e.Err == nil {
		e.Err = err
	}
}

// FailType records an unsupported-type error.
func (e *Enc) FailType(typ string) {
	e.Fail(&UnsupportedTypeError{typ})
}

// Lit appends s, which is already valid JSON text.
func (e *Enc) Lit(s string) {
	e.B = appendStr(e.B, s)
}

// Byte appends one byte of JSON punctuation.
func (e *Enc) Byte(c byte) {
	e.B = append(e.B, c)
}

// Null appends null.
func (e *Enc) Null() {
	e.B = appendStr(e.B, "null")
}

// Number appends the literal representation of a Number.
func (e *Enc) Number(v string) {
	if e.Err != nil {
		return
	}
	if v == "" {
		e.B = append(e.B, '0')
		return
	}
	if !isValidNumber(v) {
		e.Fail(fmt.Errorf("json: invalid number literal %q", v))
		return
	}
	e.B = appendStr(e.B, v)
}

func isValidNumber(s string) bool {
	if len(s) == 0 {
		return false
	}
	first := s[0]
	if first != '-' && (first < '0' || first > '9') {
		return false
	}
	return CheckValid([]byte(s)) == nil
}

// Bool appends true or false.
func (e *Enc) Bool(v bool) {
	if v {
		e.B = appendStr(e.B, "true")
	} else {
		e.B = appendStr(e.B, "false")
	}
}

// Int appends a signed integer.
func (e *Enc) Int(v int64) {
	e.B = strconv.AppendInt(e.B, v, 10)
}

// Uint appends an unsigned integer.
func (e *Enc) Uint(v uint64) {
	e.B = strconv.AppendUint(e.B, v, 10)
}

// Float appends a floating-point number in the format encoding/json uses.
func (e *Enc) Float(f float64, bits int) {
	if e.Err != nil {
		return
	}
	if math.IsInf(f, 0) || math.IsNaN(f) {
		e.Fail(&UnsupportedValueError{strconv.FormatFloat(f, 'g', -1, bits)})
		return
	}
	if f == 0 && math.Signbit(f) {
		e.B = append(e.B, "-0"...)
		return
	}
	format := floatFormat(f, bits)
	if bits == 32 {
		f = shortest32(f)
	}
	e.B = strconv.AppendFloat(e.B, f, format, -1, 64)
	if format == 'e' {
		e.B = cleanExponent(e.B)
	}
}

// floatFormat picks 'e' or 'f' as if by ES6 number to string conversion.
func floatFormat(f float64, bits int) int {
	abs := math.Abs(f)
	if abs == 0 {
		return 'f'
	}
	if bits == 64 && (abs < 1e-6 || abs >= 1e21) || bits == 32 && (float32(abs) < 1e-6 || float32(abs) >= 1e21) {
		return 'e'
	}
	return 'f'
}

// cleanExponent turns a trailing e-09 into e-9.
func cleanExponent(b []byte) []byte {
	n := len(b)
	if n >= 4 && b[n-4] == 'e' && b[n-3] == '-' && b[n-2] == '0' {
		b[n-2] = b[n-1]
		b = b[:n-1]
	}
	return b
}

// shortest32 returns the float64 whose shortest decimal form is the shortest
// one that reads back as the same float32 (strconv's 32-bit formatting).
func shortest32(f float64) float64 {
	want := float32(f)
	for p := 0; p < 9; p++ {
		s := strconv.FormatFloat(f, 'e', p, 64)
		g, _ := strconv.ParseFloat(s, 32)
		if float32(g) == want {
			h, _ := strconv.ParseFloat(s, 64)
			return h
		}
	}
	return f
}

// Str appends a quoted, escaped string.
func (e *Enc) Str(s string) {
	e.B = AppendString(e.B, []byte(s), e.EscapeHTML)
}

// QStr appends a string for the ,string tag option: the quoted form of the
// quoted form.
func (e *Enc) QStr(s string) {
	inner := AppendString(nil, []byte(s), e.EscapeHTML)
	e.B = AppendString(e.B, inner, false)
}

// Key appends the separator for member n of an object (a comma when n > 0)
// and the member name, a plain name that needs no escaping.
func (e *Enc) Key(n int, name string) {
	if n > 0 {
		e.B = append(e.B, ',')
	}
	e.B = append(e.B, '"')
	e.B = appendStr(e.B, name)
	e.B = append(e.B, '"', ':')
}

// KeyStr is Key for a member name that may need escaping.
func (e *Enc) KeyStr(n int, name string) {
	if n > 0 {
		e.B = append(e.B, ',')
	}
	e.B = AppendString(e.B, []byte(name), e.EscapeHTML)
	e.B = append(e.B, ':')
}

// Bytes appends a []byte as a base64 string, or null for a nil slice.
func (e *Enc) Bytes(v []byte) {
	if v == nil {
		e.Null()
		return
	}
	e.B = append(e.B, '"')
	e.B = appendStr(e.B, base64.StdEncoding.EncodeToString(v))
	e.B = append(e.B, '"')
}

// Raw appends a json.RawMessage: validated and compacted, null when empty.
func (e *Enc) Raw(v []byte) {
	if v == nil {
		e.Null()
		return
	}
	e.Marshaled(v, nil, "json.RawMessage")
}

// Marshaled appends the result of a MarshalJSON call: validated and
// compacted, or the call's error wrapped like Go does.
func (e *Enc) Marshaled(out []byte, err error, typ string) {
	if e.Err != nil {
		return
	}
	if err == nil {
		var b []byte
		b, err = AppendCompact(e.B, out, e.EscapeHTML)
		if err == nil {
			e.B = b
			return
		}
	}
	e.Fail(&MarshalerError{typ, err, "MarshalJSON"})
}

// SortStrings sorts map keys.
func SortStrings(a []string) {
	sort.Strings(a)
}

// IntKey and UintKey format integer map keys.
func IntKey(v int64) string {
	return strconv.FormatInt(v, 10)
}

func UintKey(v uint64) string {
	return strconv.FormatUint(v, 10)
}

// appendEscaped appends the escape sequence for the ASCII byte b.
func appendEscaped(dst []byte, b byte) []byte {
	switch b {
	case '\\', '"':
		dst = append(dst, '\\')
		dst = append(dst, b)
	case '\b':
		dst = append(dst, '\\', 'b')
	case '\f':
		dst = append(dst, '\\', 'f')
	case '\n':
		dst = append(dst, '\\', 'n')
	case '\r':
		dst = append(dst, '\\', 'r')
	case '\t':
		dst = append(dst, '\\', 't')
	default:
		// This encodes bytes < 0x20 except for \b, \f, \n, \r and \t.
		// If escapeHTML is set, it also escapes <, >, and &
		// because they can lead to security holes when
		// user-controlled strings are rendered into JSON
		// and served to some browsers.
		dst = append(dst, '\\', 'u', '0', '0', hexDigits[b>>4], hexDigits[b&0xF])
	}
	return dst
}

// AppendString appends src as a quoted JSON string.
func AppendString(dst, src []byte, escapeHTML bool) []byte {
	dst = append(dst, '"')
	start := 0
	for i := 0; i < len(src); {
		if b := src[i]; b < utf8.RuneSelf {
			if b >= 0x20 && b != '"' && b != '\\' && (!escapeHTML || (b != '<' && b != '>' && b != '&')) {
				i++
				continue
			}
			dst = append(dst, src[start:i]...)
			dst = appendEscaped(dst, b)
			i++
			start = i
			continue
		}
		c, size := utf8.DecodeRune(src[i:])
		if c == utf8.RuneError && size == 1 {
			dst = append(dst, src[start:i]...)
			dst = appendStr(dst, `�`)
			i += size
			start = i
			continue
		}
		// U+2028 is LINE SEPARATOR.
		// U+2029 is PARAGRAPH SEPARATOR.
		// They are both technically valid characters in JSON strings,
		// but don't work in JSONP, which has to be evaluated as JavaScript,
		// and can lead to security holes there. It is valid JSON to
		// escape them, so we do so unconditionally.
		// See https://en.wikipedia.org/wiki/JSON#Safety.
		if c == ' ' || c == ' ' {
			dst = append(dst, src[start:i]...)
			dst = append(dst, '\\', 'u', '2', '0', '2', hexDigits[c&0xF])
			i += size
			start = i
			continue
		}
		i += size
	}
	dst = append(dst, src[start:]...)
	dst = append(dst, '"')
	return dst
}

var errNilTarget = errors.New("json: Unmarshal(nil)")
