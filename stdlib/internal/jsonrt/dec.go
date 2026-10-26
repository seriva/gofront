// Copyright 2010 The Go Authors. All rights reserved.
// Use of this source code is governed by a BSD-style
// license that can be found in the LICENSE file.

//go:build gofront

//gofront:target both

package jsonrt

import (
	"encoding/base64"
	"errors"
	"fmt"
	"math"
	"strconv"
	"strings"
	"unicode/utf8"
)

// An UnmarshalTypeError describes a JSON value that was not appropriate for
// a value of a specific Go type.
type UnmarshalTypeError struct {
	Value  string // description of JSON value - "bool", "array", "number -5"
	Type   string // type of Go value it could not be assigned to
	Offset int64  // error occurred after reading Offset bytes
	Struct string // name of the struct type containing the field
	Field  string // the full path from the root struct to the value
}

func (e *UnmarshalTypeError) Error() string {
	if e.Struct != "" || e.Field != "" {
		return "json: cannot unmarshal " + e.Value + " into Go struct field " + e.Struct + "." + e.Field + " of type " + e.Type
	}
	return "json: cannot unmarshal " + e.Value + " into Go value of type " + e.Type
}

// An InvalidUnmarshalError describes an invalid argument passed to Unmarshal.
type InvalidUnmarshalError struct {
	Type  string // "" for a nil argument
	IsPtr bool
}

func (e *InvalidUnmarshalError) Error() string {
	if e.Type == "" {
		return "json: Unmarshal(nil)"
	}
	if !e.IsPtr {
		return "json: Unmarshal(non-pointer " + e.Type + ")"
	}
	return "json: Unmarshal(nil " + e.Type + ")"
}

// Dec is the state of one Unmarshal call. The input has been checked to be
// valid JSON, so the readers below do not look for syntax errors.
type Dec struct {
	data    []byte
	pos     int
	Err     error
	fatal   bool
	structs []string
	fields  []string
	key     string
}

// NewDec checks that data is one valid JSON value and returns a decoder
// positioned at it.
func NewDec(data []byte) (*Dec, error) {
	if err := CheckValid(data); err != nil {
		return nil, err
	}
	return &Dec{data: data}, nil
}

// InvalidUnmarshal is the error for a Unmarshal target v that is not a pointer
// to a type the compiler generated a decoder for.
func InvalidUnmarshal(v any) error {
	if v == nil {
		return &InvalidUnmarshalError{}
	}
	name := fmt.Sprintf("%T", v)
	return &InvalidUnmarshalError{Type: name, IsPtr: strings.HasPrefix(name, "*")}
}

// Done returns the first error found while decoding, if any.
func (d *Dec) Done() error {
	return d.Err
}

// Fatal records an error from an Unmarshaler; decoding stops at once.
func (d *Dec) Fatal(err error) {
	d.Err = err
	d.fatal = true
}

// Failed reports whether decoding was stopped by Fatal.
func (d *Dec) Failed() bool {
	return d.fatal
}

// Enter and Leave track the struct field being decoded for error messages.
func (d *Dec) Enter(structName, field string) {
	d.structs = append(d.structs, structName)
	d.fields = append(d.fields, field)
}

func (d *Dec) Leave() {
	n := len(d.fields) - 1
	d.structs = d.structs[:n]
	d.fields = d.fields[:n]
}

func (d *Dec) ws() {
	for d.pos < len(d.data) {
		c := d.data[d.pos]
		if c == ' ' || c == '\t' || c == '\n' || c == '\r' {
			d.pos++
		} else {
			return
		}
	}
}

func (d *Dec) peek() byte {
	d.ws()
	if d.pos >= len(d.data) {
		return 0
	}
	return d.data[d.pos]
}

// kind names the JSON value at the current position.
func (d *Dec) kind() string {
	switch d.peek() {
	case '"':
		return "string"
	case '{':
		return "object"
	case '[':
		return "array"
	case 't', 'f':
		return "bool"
	case 'n':
		return "null"
	}
	return "number"
}

func (d *Dec) typeErr(value, typ string) {
	if d.Err != nil {
		return
	}
	e := &UnmarshalTypeError{Value: value, Type: typ, Offset: int64(d.pos)}
	if len(d.fields) > 0 {
		e.Struct = d.structs[len(d.structs)-1]
		e.Field = strings.Join(d.fields, ".")
	}
	d.Err = e
}

// Mismatch records a type error for the next value, which cannot be stored
// in a value of type typ, and skips it.
func (d *Dec) Mismatch(typ string) {
	if d.fatal {
		return
	}
	k := d.kind()
	d.Skip()
	d.typeErr(k, typ)
}

// IsArray reports whether the next value is an array.
func (d *Dec) IsArray() bool {
	return d.peek() == '['
}

// Bytes decodes a base64 string into a byte slice. ok is false for null and
// for a value that is not a string (an error is recorded unless it is null).
func (d *Dec) Bytes(typ string) (v []byte, ok bool) {
	s, ok := d.String(typ)
	if !ok {
		return nil, false
	}
	b, err := base64.StdEncoding.DecodeString(s)
	if err != nil {
		d.Save(err)
		return nil, false
	}
	return b, true
}

// KeyInt parses the current object member name as an integer map key.
func (d *Dec) KeyInt(bits int, signed bool, typ string) (int64, bool) {
	s := d.key
	if signed {
		n, err := strconv.ParseInt(s, 10, bits)
		if err != nil {
			d.typeErr("number "+s, typ)
			return 0, false
		}
		return n, true
	}
	n, err := strconv.ParseUint(s, 10, bits)
	if err != nil {
		d.typeErr("number "+s, typ)
		return 0, false
	}
	return int64(n), true
}

// Unquote reads the string value of a ,string field and returns a decoder
// for the JSON text inside it, which must be a literal of the given kind
// ("string", "bool" or "number"). It returns nil for null, and for a value
// that does not qualify, after recording Go's error.
func (d *Dec) Unquote(typ, kind string) *Dec {
	if d.fatal || d.Null() {
		return nil
	}
	if d.peek() != '"' {
		d.Save(errors.New("json: invalid use of ,string struct tag, trying to unmarshal unquoted value into " + typ))
		d.Skip()
		return nil
	}
	s := d.readString()
	b := []byte(s)
	if s == "null" {
		return nil
	}
	ok := len(b) > 0 && CheckValid(b) == nil
	if ok {
		c := b[0]
		switch kind {
		case "string":
			ok = c == '"'
		case "bool":
			ok = c == 't' || c == 'f'
		default:
			ok = c == '-' || (c >= '0' && c <= '9')
		}
	}
	if !ok {
		d.Save(errors.New("json: invalid use of ,string struct tag, trying to unmarshal " + strconv.Quote(s) + " into " + typ))
		return nil
	}
	return &Dec{data: b, structs: d.structs, fields: d.fields}
}

// Merge takes over the first error of a decoder made by Unquote.
func (d *Dec) Merge(sub *Dec) {
	if d.Err == nil {
		d.Err = sub.Err
	}
}

// Save records a non-fatal error (the first one wins).
func (d *Dec) Save(err error) {
	if d.Err == nil {
		d.Err = err
	}
}

// Null consumes a null and reports whether there was one.
func (d *Dec) Null() bool {
	if d.fatal {
		return true
	}
	if d.peek() == 'n' {
		d.pos += 4
		return true
	}
	return false
}

// IsNull reports whether the next value is null, without consuming it.
func (d *Dec) IsNull() bool {
	return d.peek() == 'n'
}

// Skip consumes the next value.
func (d *Dec) Skip() {
	switch d.peek() {
	case '"':
		d.skipString()
	case '{', '[':
		d.skipContainer()
	default:
		d.skipScalar()
	}
}

func (d *Dec) skipContainer() {
	depth := 0
	for d.pos < len(d.data) {
		c := d.data[d.pos]
		if c == '"' {
			d.skipString()
			continue
		}
		d.pos++
		if c == '{' || c == '[' {
			depth++
		} else if c == '}' || c == ']' {
			depth--
			if depth == 0 {
				return
			}
		}
	}
}

func (d *Dec) skipScalar() {
	for d.pos < len(d.data) {
		c := d.data[d.pos]
		if c == ',' || c == ']' || c == '}' || c == ' ' || c == '\t' || c == '\n' || c == '\r' {
			return
		}
		d.pos++
	}
}

func (d *Dec) skipString() {
	d.pos++ // opening quote
	for d.pos < len(d.data) {
		c := d.data[d.pos]
		d.pos++
		if c == '\\' {
			d.pos++
		} else if c == '"' {
			return
		}
	}
}

// Raw consumes the next value and returns a copy of its bytes.
func (d *Dec) Raw() []byte {
	d.ws()
	start := d.pos
	d.Skip()
	out := make([]byte, d.pos-start)
	copy(out, d.data[start:d.pos])
	return out
}

// Offset is the number of input bytes consumed so far.
func (d *Dec) Offset() int {
	return d.pos
}

func (d *Dec) readNumber() string {
	start := d.pos
	for d.pos < len(d.data) {
		c := d.data[d.pos]
		if c >= '0' && c <= '9' || c == '-' || c == '+' || c == '.' || c == 'e' || c == 'E' {
			d.pos++
		} else {
			break
		}
	}
	return string(d.data[start:d.pos])
}

// Number decodes a number or string as a Number. ok is false for null.
func (d *Dec) Number(typ string) (string, bool) {
	if d.fatal || d.Null() {
		return "", false
	}
	if d.peek() == '"' {
		s, ok := d.String(typ)
		if !ok {
			return "", false
		}
		if !isValidNumber(s) {
			d.Save(fmt.Errorf("json: invalid number literal, trying to unmarshal %q into Number", s))
			return "", false
		}
		return s, true
	}
	if d.kind() == "number" {
		return d.readNumber(), true
	}
	d.Mismatch(typ)
	return "", false
}

// Bool decodes a bool. ok is false for null (leave the target alone) and for
// a value of another kind (a type error is recorded).
func (d *Dec) Bool(typ string) (v bool, ok bool) {
	if d.fatal || d.Null() {
		return false, false
	}
	c := d.peek()
	if c == 't' {
		d.pos += 4
		return true, true
	}
	if c == 'f' {
		d.pos += 5
		return false, true
	}
	k := d.kind()
	d.Skip()
	d.typeErr(k, typ)
	return false, false
}

// String decodes a string.
func (d *Dec) String(typ string) (v string, ok bool) {
	if d.fatal || d.Null() {
		return "", false
	}
	if d.peek() != '"' {
		k := d.kind()
		d.Skip()
		d.typeErr(k, typ)
		return "", false
	}
	return d.readString(), true
}

// Int decodes an integer that must fit in bits bits.
func (d *Dec) Int(bits int, typ string) (v int64, ok bool) {
	if d.fatal || d.Null() {
		return 0, false
	}
	if d.peek() == '"' || d.peek() == '{' || d.peek() == '[' || d.peek() == 't' || d.peek() == 'f' {
		k := d.kind()
		d.Skip()
		d.typeErr(k, typ)
		return 0, false
	}
	s := d.readNumber()
	n, err := strconv.ParseInt(s, 10, bits)
	if err != nil {
		d.typeErr("number "+s, typ)
		return 0, false
	}
	return n, true
}

// Uint decodes an unsigned integer that must fit in bits bits.
func (d *Dec) Uint(bits int, typ string) (v uint64, ok bool) {
	if d.fatal || d.Null() {
		return 0, false
	}
	if d.peek() == '"' || d.peek() == '{' || d.peek() == '[' || d.peek() == 't' || d.peek() == 'f' {
		k := d.kind()
		d.Skip()
		d.typeErr(k, typ)
		return 0, false
	}
	s := d.readNumber()
	n, err := strconv.ParseUint(s, 10, bits)
	if err != nil {
		d.typeErr("number "+s, typ)
		return 0, false
	}
	return n, true
}

// Float decodes a floating-point number of the given size.
func (d *Dec) Float(bits int, typ string) (v float64, ok bool) {
	if d.fatal || d.Null() {
		return 0, false
	}
	if d.peek() == '"' || d.peek() == '{' || d.peek() == '[' || d.peek() == 't' || d.peek() == 'f' {
		k := d.kind()
		d.Skip()
		d.typeErr(k, typ)
		return 0, false
	}
	s := d.readNumber()
	n, err := strconv.ParseFloat(s, bits)
	if bits == 32 {
		// Round to float32 here: the number may be out of float32 range.
		n = float64(float32(n))
	}
	if err != nil || math.IsInf(n, 0) {
		d.typeErr("number "+s, typ)
		return 0, false
	}
	return n, true
}

// ObjBegin consumes the opening brace of an object. When the value is not an
// object it records a type error, skips the value and returns false.
func (d *Dec) ObjBegin(typ string) bool {
	if d.fatal {
		return false
	}
	if d.peek() != '{' {
		k := d.kind()
		d.Skip()
		d.typeErr(k, typ)
		return false
	}
	d.pos++
	return true
}

// NextKey moves to the next member of an object; false at the closing brace.
// The member name is then available from Key.
func (d *Dec) NextKey() bool {
	if d.fatal {
		return false
	}
	c := d.peek()
	if c == '}' {
		d.pos++
		return false
	}
	if c == ',' {
		d.pos++
	}
	d.ws()
	d.key = d.readString()
	d.ws()
	d.pos++ // the colon
	return true
}

// Key is the name of the member NextKey moved to.
func (d *Dec) Key() string {
	return d.key
}

// ArrBegin consumes the opening bracket of an array.
func (d *Dec) ArrBegin(typ string) bool {
	if d.fatal {
		return false
	}
	if d.peek() != '[' {
		k := d.kind()
		d.Skip()
		d.typeErr(k, typ)
		return false
	}
	d.pos++
	return true
}

// NextElem moves to the next element of an array; false at the closing bracket.
func (d *Dec) NextElem() bool {
	if d.fatal {
		return false
	}
	c := d.peek()
	if c == ']' {
		d.pos++
		return false
	}
	if c == ',' {
		d.pos++
	}
	return true
}

// EqualFold reports whether two member names match ignoring case.
func EqualFold(a, b string) bool {
	return strings.EqualFold(a, b)
}

// readString consumes the string at the current position.
func (d *Dec) readString() string {
	d.pos++ // opening quote
	start := d.pos
	plain := true
	for d.pos < len(d.data) {
		c := d.data[d.pos]
		if c == '"' {
			break
		}
		if c == '\\' {
			plain = false
			d.pos++
		} else if c >= utf8.RuneSelf {
			plain = false
		}
		d.pos++
	}
	raw := d.data[start:d.pos]
	d.pos++ // closing quote
	if plain {
		return string(raw)
	}
	return unquote(raw)
}

func getu4(s []byte, i int) rune {
	if i+4 > len(s) {
		return -1
	}
	var r rune
	for j := i; j < i+4; j++ {
		c := s[j]
		switch {
		case '0' <= c && c <= '9':
			c = c - '0'
		case 'a' <= c && c <= 'f':
			c = c - 'a' + 10
		case 'A' <= c && c <= 'F':
			c = c - 'A' + 10
		default:
			return -1
		}
		r = r*16 + rune(c)
	}
	return r
}

// unquoteU decodes the \\u escape whose 'u' is at s[r], with a following
// \\u surrogate half when there is one. It returns the rune and the index of
// the first byte after the escape.
func unquoteU(s []byte, r int) (rune, int) {
	rr := getu4(s, r+1)
	r += 5
	if rr >= 0xD800 && rr < 0xDC00 {
		if r+1 < len(s) && s[r] == '\\' && s[r+1] == 'u' {
			rr1 := getu4(s, r+2)
			if rr1 >= 0xDC00 && rr1 < 0xE000 {
				return 0x10000 + (rr-0xD800)<<10 + (rr1 - 0xDC00), r + 6
			}
		}
		return utf8.RuneError, r
	}
	if rr >= 0xDC00 && rr < 0xE000 {
		return utf8.RuneError, r
	}
	return rr, r
}

// unquote decodes the escapes of a JSON string body and coerces it to
// well-formed UTF-8.
func unquote(s []byte) string {
	out := make([]byte, 0, len(s))
	r := 0
	for r < len(s) {
		c := s[r]
		if c == '\\' {
			r++
			switch s[r] {
			case 'b':
				out = append(out, '\b')
				r++
			case 'f':
				out = append(out, '\f')
				r++
			case 'n':
				out = append(out, '\n')
				r++
			case 'r':
				out = append(out, '\r')
				r++
			case 't':
				out = append(out, '\t')
				r++
			case 'u':
				var rr rune
				rr, r = unquoteU(s, r)
				out = utf8.AppendRune(out, rr)
			default:
				out = append(out, s[r])
				r++
			}
		} else if c < utf8.RuneSelf {
			out = append(out, c)
			r++
		} else {
			rr, size := utf8.DecodeRune(s[r:])
			r += size
			out = utf8.AppendRune(out, rr)
		}
	}
	return string(out)
}

// Any decodes the next value into the empty interface: map[string]any,
// []any, float64, string, bool or nil.
func (d *Dec) Any() any {
	if d.fatal {
		return nil
	}
	switch d.peek() {
	case '{':
		d.pos++
		m := make(map[string]any)
		for d.NextKey() {
			k := d.key
			m[k] = d.Any()
		}
		return m
	case '[':
		d.pos++
		a := make([]any, 0)
		for d.NextElem() {
			a = append(a, d.Any())
		}
		return a
	case '"':
		return d.readString()
	case 't':
		d.pos += 4
		return true
	case 'f':
		d.pos += 5
		return false
	case 'n':
		d.pos += 4
		return nil
	}
	s := d.readNumber()
	f, err := strconv.ParseFloat(s, 64)
	if err != nil {
		d.typeErr("number "+s, "float64")
		return nil
	}
	return f
}
