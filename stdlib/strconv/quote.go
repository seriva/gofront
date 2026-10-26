//go:build gofront

//gofront:target both

package strconv

import (
	"unicode"
	"unicode/utf8"
)

// IntSize is the size in bits of an int or uint value.
const IntSize = 64

const lowerhex = "0123456789abcdef"

// A NumError records a failed conversion.
type NumError struct {
	Func string // the failing function (ParseBool, ParseInt, ParseUint, ParseFloat, ParseComplex)
	Num  string // the input
	Err  error  // the reason the conversion failed (e.g. ErrRange, ErrSyntax, etc.)
}

func (e *NumError) Error() string {
	return "strconv." + e.Func + ": parsing " + Quote(e.Num) + ": " + e.Err.Error()
}

func (e *NumError) Unwrap() error { return e.Err }

// IsPrint reports whether the rune is defined as printable by Go, with
// the same definition as unicode.IsPrint: letters, numbers, punctuation,
// symbols and ASCII space.
func IsPrint(r rune) bool {
	if 0x20 <= r && r <= 0x7E {
		return true
	}
	return unicode.IsPrint(r)
}

// IsGraphic reports whether the rune is defined as a Graphic by Unicode.
func IsGraphic(r rune) bool {
	if 0x20 <= r && r <= 0x7E {
		return true
	}
	return unicode.IsGraphic(r)
}

func quoteWith(s string, quote byte, ASCIIonly, graphicOnly bool) string {
	return string(appendQuotedWith(make([]byte, 0, 3*len(s)/2), s, quote, ASCIIonly, graphicOnly))
}

func quoteRuneWith(r rune, quote byte, ASCIIonly, graphicOnly bool) string {
	return string(appendQuotedRuneWith(nil, r, quote, ASCIIonly, graphicOnly))
}

func hexDigit(v int) byte {
	return byte(lowerhex[v&0xF])
}

func appendQuotedWith(buf []byte, s string, quote byte, ASCIIonly, graphicOnly bool) []byte {
	buf = append(buf, quote)
	for len(s) > 0 {
		r, width := utf8.DecodeRuneInString(s)
		if width == 1 && r == utf8.RuneError {
			b0 := int(byte(s[0]))
			buf = append(buf, byte('\\'), byte('x'), hexDigit(b0>>4), hexDigit(b0))
			s = s[1:]
			continue
		}
		buf = appendEscapedRune(buf, r, quote, ASCIIonly, graphicOnly)
		s = s[width:]
	}
	buf = append(buf, quote)
	return buf
}

func appendQuotedRuneWith(buf []byte, r rune, quote byte, ASCIIonly, graphicOnly bool) []byte {
	buf = append(buf, quote)
	if !utf8.ValidRune(r) {
		r = utf8.RuneError
	}
	buf = appendEscapedRune(buf, r, quote, ASCIIonly, graphicOnly)
	buf = append(buf, quote)
	return buf
}

func appendEscapedRune(buf []byte, r rune, quote byte, ASCIIonly, graphicOnly bool) []byte {
	if r == rune(quote) || r == '\\' {
		buf = append(buf, byte('\\'), byte(r))
		return buf
	}
	if ASCIIonly {
		if r < utf8.RuneSelf && IsPrint(r) {
			buf = append(buf, byte(r))
			return buf
		}
	} else if IsPrint(r) || (graphicOnly && IsGraphic(r)) {
		return utf8.AppendRune(buf, r)
	}
	switch r {
	case '\a':
		buf = append(buf, byte('\\'), byte('a'))
	case '\b':
		buf = append(buf, byte('\\'), byte('b'))
	case '\f':
		buf = append(buf, byte('\\'), byte('f'))
	case '\n':
		buf = append(buf, byte('\\'), byte('n'))
	case '\r':
		buf = append(buf, byte('\\'), byte('r'))
	case '\t':
		buf = append(buf, byte('\\'), byte('t'))
	case '\v':
		buf = append(buf, byte('\\'), byte('v'))
	default:
		switch {
		case r < ' ' || r == 0x7f:
			br := int(r)
			buf = append(buf, byte('\\'), byte('x'), hexDigit(br>>4), hexDigit(br))
		case !utf8.ValidRune(r):
			r = 0xFFFD
			buf = append(buf, byte('\\'), byte('u'))
			for s := 12; s >= 0; s -= 4 {
				buf = append(buf, hexDigit(int(r>>uint(s))))
			}
		case r < 0x10000:
			buf = append(buf, byte('\\'), byte('u'))
			for s := 12; s >= 0; s -= 4 {
				buf = append(buf, hexDigit(int(r>>uint(s))))
			}
		default:
			buf = append(buf, byte('\\'), byte('U'))
			for s := 28; s >= 0; s -= 4 {
				buf = append(buf, hexDigit(int(r>>uint(s))))
			}
		}
	}
	return buf
}

// QuoteRune returns a single-quoted Go character literal representing the rune.
func QuoteRune(r rune) string {
	return quoteRuneWith(r, byte('\''), false, false)
}

// QuoteToASCII returns a double-quoted Go string literal representing s using ASCII escapes.
func QuoteToASCII(s string) string {
	return quoteWith(s, byte('"'), true, false)
}

// QuoteRuneToASCII returns a single-quoted Go character literal representing the rune using ASCII escapes.
func QuoteRuneToASCII(r rune) string {
	return quoteRuneWith(r, byte('\''), true, false)
}

// QuoteToGraphic returns a double-quoted Go string literal representing s using graphic escapes.
func QuoteToGraphic(s string) string {
	return quoteWith(s, byte('"'), false, true)
}

// QuoteRuneToGraphic returns a single-quoted Go character literal representing the rune using graphic escapes.
func QuoteRuneToGraphic(r rune) string {
	return quoteRuneWith(r, byte('\''), false, true)
}

// AppendQuote appends a double-quoted Go string literal representing s to dst.
func AppendQuote(dst []byte, s string) []byte {
	return appendQuotedWith(dst, s, byte('"'), false, false)
}

// AppendQuoteToASCII appends a double-quoted Go string literal representing s using ASCII escapes to dst.
func AppendQuoteToASCII(dst []byte, s string) []byte {
	return appendQuotedWith(dst, s, byte('"'), true, false)
}

// AppendQuoteToGraphic appends a double-quoted Go string literal representing s using graphic escapes to dst.
func AppendQuoteToGraphic(dst []byte, s string) []byte {
	return appendQuotedWith(dst, s, byte('"'), false, true)
}

// AppendQuoteRune appends a single-quoted Go character literal representing the rune to dst.
func AppendQuoteRune(dst []byte, r rune) []byte {
	return appendQuotedRuneWith(dst, r, byte('\''), false, false)
}

// AppendQuoteRuneToASCII appends a single-quoted Go character literal representing the rune using ASCII escapes to dst.
func AppendQuoteRuneToASCII(dst []byte, r rune) []byte {
	return appendQuotedRuneWith(dst, r, byte('\''), true, false)
}

// AppendQuoteRuneToGraphic appends a single-quoted Go character literal representing the rune using graphic escapes to dst.
func AppendQuoteRuneToGraphic(dst []byte, r rune) []byte {
	return appendQuotedRuneWith(dst, r, byte('\''), false, true)
}

// CanBackquote reports whether the string s can be represented unchanged as a single-line backquoted string.
func CanBackquote(s string) bool {
	for len(s) > 0 {
		r, wid := utf8.DecodeRuneInString(s)
		s = s[wid:]
		if wid > 1 {
			if r == '\ufeff' {
				return false
			}
			continue
		}
		if r == utf8.RuneError {
			return false
		}
		if (r < ' ' && r != '\t') || r == '`' || r == '\u007F' {
			return false
		}
	}
	return true
}

func unhex(b byte) (rune, bool) {
	switch {
	case byte('0') <= b && b <= byte('9'):
		return rune(b - byte('0')), true
	case byte('a') <= b && b <= byte('f'):
		return rune(b - byte('a') + 10), true
	case byte('A') <= b && b <= byte('F'):
		return rune(b - byte('A') + 10), true
	}
	return 0, false
}

func unquoteHex(c byte, s string) (rune, bool, string, error) {
	n := 0
	switch c {
	case byte('x'):
		n = 2
	case byte('u'):
		n = 4
	case byte('U'):
		n = 8
	}
	if len(s) < n {
		return 0, false, "", ErrSyntax
	}
	var v rune
	for j := 0; j < n; j++ {
		x, ok := unhex(byte(s[j]))
		if !ok {
			return 0, false, "", ErrSyntax
		}
		v = v<<4 | x
	}
	s = s[n:]
	if c == byte('x') {
		return v, false, s, nil
	}
	if !utf8.ValidRune(v) {
		return 0, false, "", ErrSyntax
	}
	return v, true, s, nil
}

func unquoteOctal(c byte, s string) (rune, string, error) {
	v := rune(c - byte('0'))
	if len(s) < 2 {
		return 0, "", ErrSyntax
	}
	for j := 0; j < 2; j++ {
		b := byte(s[j])
		if b < byte('0') || b > byte('7') {
			return 0, "", ErrSyntax
		}
		v = (v << 3) | rune(b-byte('0'))
	}
	if v > 255 {
		return 0, "", ErrSyntax
	}
	return v, s[2:], nil
}

// UnquoteChar decodes the first character or byte in the escaped string or character literal represented by s.
func UnquoteChar(s string, quote byte) (value rune, multibyte bool, tail string, err error) {
	if len(s) == 0 {
		return 0, false, "", ErrSyntax
	}
	c := byte(s[0])
	if c == quote && (quote == byte('\'') || quote == byte('"')) {
		return 0, false, "", ErrSyntax
	}
	if rune(c) >= utf8.RuneSelf {
		r, size := utf8.DecodeRuneInString(s)
		return r, true, s[size:], nil
	}
	if c != byte('\\') {
		return rune(c), false, s[1:], nil
	}
	if len(s) <= 1 {
		return 0, false, "", ErrSyntax
	}
	esc := byte(s[1])
	s = s[2:]
	switch esc {
	case byte('a'):
		return '\a', false, s, nil
	case byte('b'):
		return '\b', false, s, nil
	case byte('f'):
		return '\f', false, s, nil
	case byte('n'):
		return '\n', false, s, nil
	case byte('r'):
		return '\r', false, s, nil
	case byte('t'):
		return '\t', false, s, nil
	case byte('v'):
		return '\v', false, s, nil
	case byte('x'), byte('u'), byte('U'):
		v, mb, rem, err := unquoteHex(esc, s)
		return v, mb, rem, err
	case byte('0'), byte('1'), byte('2'), byte('3'), byte('4'), byte('5'), byte('6'), byte('7'):
		v, rem, err := unquoteOctal(esc, s)
		return v, false, rem, err
	case byte('\\'):
		return '\\', false, s, nil
	case byte('\''), byte('"'):
		if esc != quote {
			return 0, false, "", ErrSyntax
		}
		return rune(esc), false, s, nil
	default:
		return 0, false, "", ErrSyntax
	}
}

// QuotedPrefix returns the quoted string at the prefix of s.
func QuotedPrefix(s string) (string, error) {
	if len(s) < 2 {
		return "", ErrSyntax
	}
	quote := byte(s[0])
	if quote != byte('"') && quote != byte('\'') && quote != byte('`') {
		return "", ErrSyntax
	}
	if quote == byte('`') {
		for i := 1; i < len(s); i++ {
			if byte(s[i]) == byte('`') {
				return s[:i+1], nil
			}
		}
		return "", ErrSyntax
	}
	rem := s[1:]
	for len(rem) > 0 {
		if byte(rem[0]) == quote {
			return s[:len(s)-len(rem)+1], nil
		}
		_, _, next, err := UnquoteChar(rem, quote)
		if err != nil {
			return "", err
		}
		rem = next
	}
	return "", ErrSyntax
}
