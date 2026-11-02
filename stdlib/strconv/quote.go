//go:build gofront

//gofront:target both

package strconv

import "unicode/utf8"

const lowerhex = "0123456789abcdef"

func bsearch16(s []uint16, v uint16) (int, bool) {
	n := len(s)
	i, j := 0, n
	for i < j {
		h := i + (j-i)>>1
		if s[h] < v {
			i = h + 1
		} else {
			j = h
		}
	}
	return i, i < n && s[i] == v
}

func bsearch32(s []uint32, v uint32) (int, bool) {
	n := len(s)
	i, j := 0, n
	for i < j {
		h := i + (j-i)>>1
		if s[h] < v {
			i = h + 1
		} else {
			j = h
		}
	}
	return i, i < n && s[i] == v
}

// IsPrint reports whether the rune is defined as printable by Go, with
// the same definition as [unicode.IsPrint]: letters, numbers, punctuation,
// symbols and ASCII space.
func IsPrint(r rune) bool {
	// Fast check for Latin-1
	if r <= 0xFF {
		if 0x20 <= r && r <= 0x7E {
			// All the ASCII is printable from space through DEL-1.
			return true
		}
		if 0xA1 <= r && r <= 0xFF {
			// Similarly for ¡ through ÿ...
			return r != 0xAD // ...except for the bizarre soft hyphen.
		}
		return false
	}

	// First, find first i such that isPrint[i] >= x.
	// This is the index of either the start or end of a pair that might span x.
	// The start is even (isPrint[i&^1]) and the end is odd (isPrint[i|1]).
	// If we find x in a range, make sure x is not in isNotPrint list.
	if 0 <= r && r < 1<<16 {
		rr := uint16(r)
		i, _ := bsearch16(isPrint16, rr)
		if i >= len(isPrint16) || rr < isPrint16[i&^1] || isPrint16[i|1] < rr {
			return false
		}
		_, found := bsearch16(isNotPrint16, rr)
		return !found
	}

	rr := uint32(r)
	i, _ := bsearch32(isPrint32, rr)
	if i >= len(isPrint32) || rr < isPrint32[i&^1] || isPrint32[i|1] < rr {
		return false
	}
	if r >= 0x20000 {
		return true
	}
	r -= 0x10000
	_, found := bsearch16(isNotPrint32, uint16(r))
	return !found
}

// IsGraphic reports whether the rune is defined as a Graphic by Unicode. Such
// characters include letters, marks, numbers, punctuation, symbols, and
// spaces, from categories L, M, N, P, S, and Zs.
func IsGraphic(r rune) bool {
	if IsPrint(r) {
		return true
	}
	// We know r must fit in 16 bits - see makeisprint.go.
	if r > 0xFFFF {
		return false
	}
	_, found := bsearch16(isGraphic, uint16(r))
	return found
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

// Quote returns a double-quoted Go string literal representing s. The
// returned string uses Go escape sequences (\t, \n, \xFF, \u0100) for
// control characters and non-printable characters as defined by [IsPrint].
func Quote(s string) string {
	return quoteWith(s, byte('"'), false, false)
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

// AppendQuote appends a double-quoted Go string literal representing s to dst.
func AppendQuote(dst []byte, s string) []byte {
	return appendQuotedWith(dst, s, byte('"'), false, false)
}

// AppendQuoteToASCII appends a double-quoted Go string literal representing s using ASCII escapes to dst.
func AppendQuoteToASCII(dst []byte, s string) []byte {
	return appendQuotedWith(dst, s, byte('"'), true, false)
}

// AppendQuoteRune appends a single-quoted Go character literal representing the rune to dst.
func AppendQuoteRune(dst []byte, r rune) []byte {
	return appendQuotedRuneWith(dst, r, byte('\''), false, false)
}

// AppendQuoteRuneToASCII appends a single-quoted Go character literal representing the rune using ASCII escapes to dst.
func AppendQuoteRuneToASCII(dst []byte, r rune) []byte {
	return appendQuotedRuneWith(dst, r, byte('\''), true, false)
}

// CanBackquote reports whether the string s can be represented unchanged as a single-line backquoted string.
func CanBackquote(s string) bool {
	for len(s) > 0 {
		r, wid := utf8.DecodeRuneInString(s)
		s = s[wid:]
		if r == '\ufeff' {
			return false
		}
		if wid > 1 {
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
		if s[j] >= utf8.RuneSelf {
			return 0, false, "", ErrSyntax
		}
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
		if s[j] >= utf8.RuneSelf {
			return 0, "", ErrSyntax
		}
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
	// A string index is a UTF-16 unit: decide on it before narrowing to a byte.
	if s[0] >= utf8.RuneSelf {
		r, size := utf8.DecodeRuneInString(s)
		return r, true, s[size:], nil
	}
	c := byte(s[0])
	if c == quote && (quote == byte('\'') || quote == byte('"')) {
		return 0, false, "", ErrSyntax
	}
	if c != byte('\\') {
		return rune(c), false, s[1:], nil
	}
	if len(s) <= 1 {
		return 0, false, "", ErrSyntax
	}
	if s[1] >= utf8.RuneSelf {
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

// QuotedPrefix returns the quoted string (as understood by [Unquote]) at the prefix of s.
// If s does not start with a valid quoted string, QuotedPrefix returns an error.
func QuotedPrefix(s string) (string, error) {
	out, _, err := unquote(s, false)
	return out, err
}

// Unquote interprets s as a single-quoted, double-quoted,
// or backquoted Go string literal, returning the string value
// that s quotes.  (If s is single-quoted, it would be a Go
// character literal; Unquote returns the corresponding
// one-character string. For an empty character literal
// Unquote returns the empty string.)
func Unquote(s string) (string, error) {
	out, rem, err := unquote(s, true)
	if len(rem) > 0 {
		return "", ErrSyntax
	}
	return out, err
}

// unquote parses a quoted string at the start of the input,
// returning the parsed prefix, the remaining suffix, and any parse errors.
// If unescape is true, the parsed prefix is unescaped,
// otherwise the input prefix is provided verbatim.
func unquote(in string, unescape bool) (out, rem string, err error) {
	// Determine the quote form and optimistically find the terminating quote.
	if len(in) < 2 {
		return "", in, ErrSyntax
	}
	if in[0] > 0x7F {
		return "", in, ErrSyntax
	}
	quote := byte(in[0])
	end := indexByte(in[1:], quote)
	if end < 0 {
		return "", in, ErrSyntax
	}
	end += 2 // position after terminating quote; may be wrong if escape sequences are present

	switch quote {
	case '`':
		switch {
		case !unescape:
			out = in[:end] // include quotes
		case !containsByte(in[:end], '\r'):
			out = in[len("`") : end-len("`")] // exclude quotes
		default:
			// Carriage return characters ('\r') inside raw string literals
			// are discarded from the raw string value.
			buf := make([]byte, 0, end-len("`")-len("\r")-len("`"))
			for i := len("`"); i < end-len("`"); i++ {
				if in[i] != '\r' {
					buf = append(buf, in[i])
				}
			}
			out = string(buf)
		}
		// NOTE: Prior implementations did not verify that raw strings consist
		// of valid UTF-8 characters and we continue to not verify it as such.
		// The Go specification does not explicitly require valid UTF-8,
		// but only mention that it is implicitly valid for Go source code
		// (which must be valid UTF-8).
		return out, in[end:], nil
	case '"', '\'':
		// Handle quoted strings without any escape sequences.
		if !containsByte(in[:end], '\\') && !containsByte(in[:end], '\n') {
			var valid bool
			switch quote {
			case '"':
				valid = utf8.ValidString(in[len(`"`) : end-len(`"`)])
			case '\'':
				r, n := utf8.DecodeRuneInString(in[len("'") : end-len("'")])
				valid = len("'")+n+len("'") == end && (r != utf8.RuneError || n != 1)
			}
			if valid {
				out = in[:end]
				if unescape {
					out = out[1 : end-1] // exclude quotes
				}
				return out, in[end:], nil
			}
		}

		// Handle quoted strings with escape sequences.
		var buf []byte
		in0 := in
		in = in[1:] // skip starting quote
		if unescape {
			buf = make([]byte, 0, 3*end/2) // try to avoid more allocations
		}
		for len(in) > 0 && in[0] != int(quote) {
			// Process the next character,
			// rejecting any unescaped newline characters which are invalid.
			r, multibyte, rem, err := UnquoteChar(in, quote)
			if in[0] == '\n' || err != nil {
				return "", in0, ErrSyntax
			}
			in = rem

			// Append the character if unescaping the input.
			if unescape {
				if r < utf8.RuneSelf || !multibyte {
					buf = append(buf, byte(r))
				} else {
					buf = utf8.AppendRune(buf, r)
				}
			}

			// Single quoted strings must be a single character.
			if quote == '\'' {
				break
			}
		}

		// Verify that the string ends with a terminating quote.
		if !(len(in) > 0 && in[0] == quote) {
			return "", in0, ErrSyntax
		}
		in = in[1:] // skip terminating quote

		if unescape {
			return string(buf), in, nil
		}
		return in0[:len(in0)-len(in)], in, nil
	default:
		return "", in, ErrSyntax
	}
}

func indexByte(s string, c byte) int {
	for i := 0; i < len(s); i++ {
		if s[i] == c {
			return i
		}
	}
	return -1
}

func containsByte(s string, c byte) bool {
	return indexByte(s, c) >= 0
}
