// Copyright 2009 The Go Authors. All rights reserved.
// Use of this source code is governed by a BSD-style
// license that can be found in the LICENSE file.

//go:build gofront

//gofront:target both

package fmt

import (
	"strconv"
	"unicode/utf8"
)

const (
	ldigits = "0123456789abcdefx"
	udigits = "0123456789ABCDEFX"
)

const (
	signed   = true
	unsigned = false
)

// fmtFlags is the set of flags a verb carries.
type fmtFlags struct {
	widPresent  bool
	precPresent bool
	minus       bool
	plus        bool
	sharp       bool
	space       bool
	zero        bool

	// For the formats %+v %#v, we set the plusV/sharpV flags and clear the
	// plus/sharp flags since %+v and %#v are in effect different, flagless
	// formats set at the top level.
	plusV  bool
	sharpV bool
}

// fmtState is the part of the printer that lays out one value in a buffer. It
// holds the flags of fmtFlags directly: an embedded struct would be renamed
// with its type when the package is linked.
type fmtState struct {
	// buf is the output buffer: its length is the capacity and n the bytes
	// written, so an append is an indexed store, not a new slice value.
	buf []byte
	n   int

	widPresent  bool
	precPresent bool
	minus       bool
	plus        bool
	sharp       bool
	space       bool
	zero        bool
	plusV       bool
	sharpV      bool

	wid    int
	prec   int
	intbuf []byte
}

// grow makes room for need more bytes.
func (f *fmtState) grow(need int) {
	size := 2 * len(f.buf)
	if size < f.n+need {
		size = f.n + need
	}
	nb := make([]byte, size)
	copy(nb, f.buf[:f.n])
	f.buf = nb
}

// scratch returns the 68-byte buffer numbers and quotes are built in.
func (f *fmtState) scratch() []byte {
	if f.intbuf == nil {
		f.intbuf = make([]byte, 68)
	}
	return f.intbuf
}

func (f *fmtState) putByte(c byte) {
	if f.n == len(f.buf) {
		f.grow(1)
	}
	f.buf[f.n] = c
	f.n++
}

func (f *fmtState) putBytes(b []byte) {
	n := len(b)
	if f.n+n > len(f.buf) {
		f.grow(n)
	}
	buf, k := f.buf, f.n
	for i := 0; i < n; i++ {
		buf[k+i] = b[i]
	}
	f.n = k + n
}

// putString appends s. An ASCII string is stored byte by byte; any other goes
// through the encoder.
func (f *fmtState) putString(s string) {
	n := len(s)
	if f.n+n > len(f.buf) {
		f.grow(n)
	}
	buf, k := f.buf, f.n
	for _, r := range s {
		if r >= 0x80 {
			f.putBytes([]byte(s))
			return
		}
		buf[k] = byte(r)
		k++
	}
	f.n = k
}

// bytes returns what has been written.
func (f *fmtState) bytes() []byte {
	return f.buf[:f.n]
}

func (f *fmtState) clearflags() {
	f.restoreFlags(fmtFlags{})
	f.wid = 0
	f.prec = 0
}

// saveFlags returns the flags of the verb being formatted.
func (f *fmtState) saveFlags() fmtFlags {
	return fmtFlags{f.widPresent, f.precPresent, f.minus, f.plus, f.sharp, f.space, f.zero, f.plusV, f.sharpV}
}

// restoreFlags sets the flags saved by saveFlags.
func (f *fmtState) restoreFlags(s fmtFlags) {
	f.widPresent = s.widPresent
	f.precPresent = s.precPresent
	f.minus = s.minus
	f.plus = s.plus
	f.sharp = s.sharp
	f.space = s.space
	f.zero = s.zero
	f.plusV = s.plusV
	f.sharpV = s.sharpV
}

// writePadding appends n padding bytes.
func (f *fmtState) writePadding(n int) {
	if n <= 0 {
		return
	}
	padByte := byte(' ')
	// Zero padding is allowed only to the left.
	if f.zero && !f.minus {
		padByte = byte('0')
	}
	for i := 0; i < n; i++ {
		f.putByte(padByte)
	}
}

// pad appends b to f.buf, padded on left (!f.minus) or right (f.minus).
func (f *fmtState) pad(b []byte) {
	if !f.widPresent || f.wid == 0 {
		f.putBytes(b)
		return
	}
	width := f.wid - utf8.RuneCount(b)
	if !f.minus {
		// left padding
		f.writePadding(width)
		f.putBytes(b)
	} else {
		// right padding
		f.putBytes(b)
		f.writePadding(width)
	}
}

// padString appends s to f.buf, padded on left (!f.minus) or right (f.minus).
func (f *fmtState) padString(s string) {
	if !f.widPresent || f.wid == 0 {
		f.putString(s)
		return
	}
	width := f.wid - utf8.RuneCountInString(s)
	if !f.minus {
		// left padding
		f.writePadding(width)
		f.putString(s)
	} else {
		// right padding
		f.putString(s)
		f.writePadding(width)
	}
}

// fmtBoolean formats a boolean.
func (f *fmtState) fmtBoolean(v bool) {
	if v {
		f.padString("true")
	} else {
		f.padString("false")
	}
}

// fmtUnicode formats a uint64 as "U+0078" or with f.sharp set as "U+0078 'x'".
func (f *fmtState) fmtUnicode(u uint64) {
	buf := f.scratch()[0:]

	// With default precision set the maximum needed buf length is 18
	// for formatting -1 with %#U ("U+FFFFFFFFFFFFFFFF") which fits
	// into the already allocated intbuf with a capacity of 68 bytes.
	prec := 4
	if f.precPresent && f.prec > 4 {
		prec = f.prec
		// Compute space needed for "U+" , number, " '", character, "'".
		width := 2 + prec + 2 + utf8.UTFMax + 1
		if width > len(buf) {
			buf = make([]byte, width)
		}
	}

	// Format into buf, ending at buf[i]. Building numbers is easier right-to-left.
	i := len(buf)

	// For %#U we want to add a space and a quoted character at the end of the buffer.
	if f.sharp && u <= utf8.MaxRune && strconv.IsPrint(rune(u)) {
		i--
		buf[i] = '\''
		i -= utf8.RuneLen(rune(u))
		utf8.EncodeRune(buf[i:], rune(u))
		i--
		buf[i] = '\''
		i--
		buf[i] = ' '
	}
	// Format the Unicode code point u as a hexadecimal number.
	for u >= 16 {
		i--
		buf[i] = udigits[u&0xF]
		prec--
		u >>= 4
	}
	i--
	buf[i] = udigits[u]
	prec--
	// Add zeros in front of the number until requested precision is reached.
	for prec > 0 {
		i--
		buf[i] = '0'
		prec--
	}
	// Add a leading "U+".
	i--
	buf[i] = '+'
	i--
	buf[i] = 'U'

	oldZero := f.zero
	f.zero = false
	f.pad(buf[i:])
	f.zero = oldZero
}

// fmtInteger formats signed and unsigned integers.
func (f *fmtState) fmtInteger(u uint64, base int, isSigned bool, verb rune, digits string) {
	negative := isSigned && int64(u) < 0
	if negative {
		u = -u
	}

	buf := f.scratch()[0:]
	// The already allocated f.intbuf with a capacity of 68 bytes
	// is large enough for integer formatting when no precision or width is set.
	if f.widPresent || f.precPresent {
		// Account 3 extra bytes for possible addition of a sign and "0x".
		width := 3 + f.wid + f.prec // wid and prec are always positive.
		if width > len(buf) {
			// We're going to need a bigger boat.
			buf = make([]byte, width)
		}
	}

	// Two ways to ask for extra leading zero digits: %.3d or %03d.
	// If both are specified the f.zero flag is ignored and
	// padding with spaces is used instead.
	prec := 0
	if f.precPresent {
		prec = f.prec
		// Precision of 0 and value of 0 means "print nothing" but padding.
		if prec == 0 && u == 0 {
			oldZero := f.zero
			f.zero = false
			f.writePadding(f.wid)
			f.zero = oldZero
			return
		}
	} else if f.zero && !f.minus && f.widPresent { // Zero padding is allowed only to the left.
		prec = f.wid
		if negative || f.plus || f.space {
			prec-- // leave room for sign
		}
	}

	// Because printing is easier right-to-left: format u into buf, ending at buf[i].
	i := len(buf)
	switch base {
	case 10:
		if u < 1<<31 {
			// Small values divide as int: a 64-bit division is much slower
			// where uint64 is a BigInt.
			n := int(u)
			for n >= 10 {
				i--
				next := n / 10
				buf[i] = byte('0' + n - next*10)
				n = next
			}
			u = uint64(n)
		}
		for u >= 10 {
			i--
			next := u / 10
			buf[i] = byte('0' + u - next*10)
			u = next
		}
	case 16:
		for u >= 16 {
			i--
			buf[i] = digits[u&0xF]
			u >>= 4
		}
	case 8:
		for u >= 8 {
			i--
			buf[i] = byte('0' + u&7)
			u >>= 3
		}
	case 2:
		for u >= 2 {
			i--
			buf[i] = byte('0' + u&1)
			u >>= 1
		}
	default:
		panic("fmt: unknown base; can't happen")
	}
	i--
	buf[i] = digits[u]
	for i > 0 && prec > len(buf)-i {
		i--
		buf[i] = '0'
	}

	// Various prefixes: 0x, -, etc.
	if f.sharp {
		switch base {
		case 2:
			// Add a leading 0b.
			i--
			buf[i] = 'b'
			i--
			buf[i] = '0'
		case 8:
			if buf[i] != '0' {
				i--
				buf[i] = '0'
			}
		case 16:
			// Add a leading 0x or 0X.
			i--
			buf[i] = digits[16]
			i--
			buf[i] = '0'
		}
	}
	if verb == 'O' {
		i--
		buf[i] = 'o'
		i--
		buf[i] = '0'
	}

	if negative {
		i--
		buf[i] = '-'
	} else if f.plus {
		i--
		buf[i] = '+'
	} else if f.space {
		i--
		buf[i] = ' '
	}

	// Left padding with zeros has already been handled like precision earlier
	// or the f.zero flag is ignored due to an explicit precision.
	oldZero := f.zero
	f.zero = false
	f.pad(buf[i:])
	f.zero = oldZero
}

// truncateString truncates the string s to the specified precision, if present.
func (f *fmtState) truncateString(s string) string {
	if f.precPresent {
		n := f.prec
		for i := range s {
			n--
			if n < 0 {
				return s[:i]
			}
		}
	}
	return s
}

// truncate truncates the byte slice b as a string of the specified precision, if present.
func (f *fmtState) truncate(b []byte) []byte {
	if f.precPresent {
		n := f.prec
		for i := 0; i < len(b); {
			n--
			if n < 0 {
				return b[:i]
			}
			wid := 1
			if b[i] >= utf8.RuneSelf {
				_, wid = utf8.DecodeRune(b[i:])
			}
			i += wid
		}
	}
	return b
}

// fmtS formats a string.
func (f *fmtState) fmtS(s string) {
	s = f.truncateString(s)
	f.padString(s)
}

// fmtBs formats the byte slice b as if it was formatted as string with fmtS.
func (f *fmtState) fmtBs(b []byte) {
	b = f.truncate(b)
	f.pad(b)
}

// fmtSbx formats a string or byte slice as a hexadecimal encoding of its bytes.
func (f *fmtState) fmtSbx(s string, b []byte, digits string) {
	length := len(b)
	if b == nil {
		// No byte slice present. Assume string s should be encoded.
		length = len(s)
	}
	// Set length to not process more bytes than the precision demands.
	if f.precPresent && f.prec < length {
		length = f.prec
	}
	// Compute width of the encoding taking into account the f.sharp and f.space flag.
	width := 2 * length
	if width > 0 {
		if f.space {
			// Each element encoded by two hexadecimals will get a leading 0x or 0X.
			if f.sharp {
				width *= 2
			}
			// Elements will be separated by a space.
			width += length - 1
		} else if f.sharp {
			// Only a leading 0x or 0X will be added for the whole string.
			width += 2
		}
	} else { // The byte slice or string that should be encoded is empty.
		if f.widPresent {
			f.writePadding(f.wid)
		}
		return
	}
	// Handle padding to the left.
	if f.widPresent && f.wid > width && !f.minus {
		f.writePadding(f.wid - width)
	}
	// Write the encoding directly into the output buffer.
	if f.sharp {
		// Add leading 0x or 0X.
		f.putByte('0')
		f.putByte(digits[16])
	}
	for i := 0; i < length; i++ {
		if f.space && i > 0 {
			// Separate elements with a space.
			f.putByte(' ')
			if f.sharp {
				// Add leading 0x or 0X for each element.
				f.putByte('0')
		f.putByte(digits[16])
			}
		}
		var c byte
		if b != nil {
			c = b[i] // Take a byte from the input byte slice.
		} else {
			c = s[i] // Take a byte from the input string.
		}
		// Encode each byte as two hexadecimal digits.
		f.putByte(digits[c>>4])
		f.putByte(digits[c&0xF])
	}
	// Handle padding to the right.
	if f.widPresent && f.wid > width && f.minus {
		f.writePadding(f.wid - width)
	}
}

// fmtSx formats a string as a hexadecimal encoding of its bytes.
func (f *fmtState) fmtSx(s, digits string) {
	f.fmtSbx(s, nil, digits)
}

// fmtBx formats a byte slice as a hexadecimal encoding of its bytes.
func (f *fmtState) fmtBx(b []byte, digits string) {
	f.fmtSbx("", b, digits)
}

// fmtQ formats a string as a double-quoted, escaped Go string constant.
// If f.sharp is set a raw (backquoted) string may be returned instead
// if the string does not contain any control characters other than tab.
func (f *fmtState) fmtQ(s string) {
	s = f.truncateString(s)
	if f.sharp && strconv.CanBackquote(s) {
		f.padString("`" + s + "`")
		return
	}
	if !f.plus && plainQuotable(s) {
		f.padString("\"" + s + "\"")
		return
	}
	buf := f.scratch()[:0]
	if f.plus {
		f.pad(strconv.AppendQuoteToASCII(buf, s))
	} else {
		f.pad(strconv.AppendQuote(buf, s))
	}
}

// plainQuotable reports whether Quote leaves s as it is between the quotes:
// printable ASCII without a quote or backslash.
func plainQuotable(s string) bool {
	for i := 0; i < len(s); i++ {
		c := s[i]
		if c < ' ' || c > '~' || c == '"' || c == '\\' {
			return false
		}
	}
	return true
}

// fixedFloat formats f, a finite float64 of at least zero, with prec digits
// after the point; "" when the host cannot, in which case the caller formats
// it with strconv.
//
//gofront:native strconv.fixed
func fixedFloat(f float64, prec int) string {
	return ""
}

// fmtFixed is fmtFloat for the plain %f of a float64: it reports false when it
// wrote nothing.
func (f *fmtState) fmtFixed(v float64, prec int) bool {
	neg := v < 0 || (v == 0 && 1/v < 0)
	if neg {
		v = -v
	}
	s := fixedFloat(v, prec)
	if s == "" {
		return false
	}
	sign := ""
	if neg {
		sign = "-"
	} else if f.plus {
		sign = "+"
	} else if f.space {
		sign = " "
	}
	if sign == "" {
		f.padString(s)
	} else if f.zero && !f.minus && f.widPresent && f.wid > len(s)+1 {
		// Zero padding goes between the sign and the digits.
		f.putString(sign)
		f.writePadding(f.wid - len(s) - 1)
		f.putString(s)
	} else {
		f.padString(sign + s)
	}
	return true
}

// fmtC formats an integer as a Unicode character.
// If the character is not valid Unicode, it will print '�'.
func (f *fmtState) fmtC(c uint64) {
	// Explicitly check whether c exceeds utf8.MaxRune since the conversion
	// of a uint64 to a rune may lose precision that indicates an overflow.
	r := rune(c)
	if c > utf8.MaxRune {
		r = utf8.RuneError
	}
	buf := f.scratch()[:0]
	f.pad(utf8.AppendRune(buf, r))
}

// fmtQc formats an integer as a single-quoted, escaped Go character constant.
// If the character is not valid Unicode, it will print '�'.
func (f *fmtState) fmtQc(c uint64) {
	r := rune(c)
	if c > utf8.MaxRune {
		r = utf8.RuneError
	}
	buf := f.scratch()[:0]
	if f.plus {
		f.pad(strconv.AppendQuoteRuneToASCII(buf, r))
	} else {
		f.pad(strconv.AppendQuoteRune(buf, r))
	}
}

// fmtFloat formats floats. The default precision for each verb
// is specified as last argument in the call to fmt_float.
func (f *fmtState) fmtFloat(v float64, size int, verb rune, prec int) {
	// Format number, reserving space for leading + sign if needed.
	if f.precPresent {
		prec = f.prec
	}
	if verb == 'f' && size == 64 && !f.sharp && prec >= 0 && prec <= 60 && v-v == 0 && f.fmtFixed(v, prec) {
		return
	}
	num := strconv.AppendFloat(append(f.scratch()[:0], '+'), v, byte(verb), prec, size)
	if num[1] == '-' || num[1] == '+' {
		num = num[1:]
	} else {
		num[0] = '+'
	}
	// f.space means to add a leading space instead of a "+" sign unless f.plus is used.
	if f.space && num[0] == '+' && !f.plus {
		num[0] = ' '
	}
	// Special handling for infinities and NaN,
	// which don't look like a number so shouldn't be padded with zeros.
	if num[1] == 'I' || num[1] == 'N' {
		oldZero := f.zero
		f.zero = false
		if num[1] == 'N' && !f.space && !f.plus {
			num = num[1:]
		}
		f.pad(num)
		f.zero = oldZero
		return
	}
	// The sharp flag forces printing a decimal point but removes
	// trailing zeros for %e, %f with the shortest flag.
	if f.sharp && verb != 'b' {
		digits := 0
		switch verb {
		case 'v', 'g', 'G', 'x':
			digits = prec
			// If no precision is set explicitly use a precision of 6.
			if digits == -1 {
				digits = 6
			}
		}

		// Buffer pre-allocated with enough room for
		// exponent notations of the form "e+123" or "p-1023".
		tail := make([]byte, 0, 6)
		hasDecimalPoint := false
		sawNonzeroDigit := false
		// Starting from i = 1 to skip sign at num[0].
		for i := 1; i < len(num); i++ {
			c := num[i]
			if c == '.' {
				hasDecimalPoint = true
			} else if c == 'p' || c == 'P' || ((c == 'e' || c == 'E') && verb != 'x' && verb != 'X') {
				tail = append(tail, num[i:]...)
				num = num[:i]
			} else {
				// Count significant digits after the first non-zero digit.
				if c != '0' {
					sawNonzeroDigit = true
				}
				if sawNonzeroDigit {
					digits--
				}
			}
		}
		if !hasDecimalPoint {
			// Leading digit 0 should contribute once to digits.
			if len(num) == 2 && num[1] == '0' {
				digits--
			}
			num = append(num, '.')
		}
		for digits > 0 {
			num = append(num, '0')
			digits--
		}
		num = append(num, tail...)
	}
	// We want a sign if asked for and if the sign is not positive.
	if f.plus || num[0] != '+' {
		// If we're zero padding to the left we want the sign before the leading zeros.
		// Achieve this by writing the sign out and then padding the unsigned number.
		// Zero padding is allowed only to the left.
		if f.zero && !f.minus && f.widPresent && f.wid > len(num) {
			f.putByte(num[0])
			f.writePadding(f.wid - len(num))
			f.putBytes(num[1:])
			return
		}
		f.pad(num)
		return
	}
	// No sign to show and the number is positive; just print the unsigned number.
	f.pad(num[1:])
}
