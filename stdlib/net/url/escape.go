//go:build gofront
//gofront:target both

package url

import (
	"strconv"
)

type encoding uint8

const (
	encodePath encoding = 1 << iota
	encodePathSegment
	encodeHost
	encodeZone
	encodeUserPassword
	encodeQueryComponent
	encodeFragment

	hexChar
)

var table = [256]encoding{
	'!':  encodeFragment | encodeZone | encodeHost,
	'"':  encodeZone | encodeHost,
	'$':  encodeFragment | encodeUserPassword | encodeZone | encodeHost | encodePathSegment | encodePath,
	'&':  encodeFragment | encodeUserPassword | encodeZone | encodeHost | encodePathSegment | encodePath,
	'\'': encodeZone | encodeHost,
	'(':  encodeFragment | encodeZone | encodeHost,
	')':  encodeFragment | encodeZone | encodeHost,
	'*':  encodeFragment | encodeZone | encodeHost,
	'+':  encodeFragment | encodeUserPassword | encodeZone | encodeHost | encodePathSegment | encodePath,
	',':  encodeFragment | encodeUserPassword | encodeZone | encodeHost | encodePath,
	'-':  encodeFragment | encodeQueryComponent | encodeUserPassword | encodeZone | encodeHost | encodePathSegment | encodePath,
	'.':  encodeFragment | encodeQueryComponent | encodeUserPassword | encodeZone | encodeHost | encodePathSegment | encodePath,
	'/':  encodeFragment | encodePath,
	'0':  hexChar | encodeFragment | encodeQueryComponent | encodeUserPassword | encodeZone | encodeHost | encodePathSegment | encodePath,
	'1':  hexChar | encodeFragment | encodeQueryComponent | encodeUserPassword | encodeZone | encodeHost | encodePathSegment | encodePath,
	'2':  hexChar | encodeFragment | encodeQueryComponent | encodeUserPassword | encodeZone | encodeHost | encodePathSegment | encodePath,
	'3':  hexChar | encodeFragment | encodeQueryComponent | encodeUserPassword | encodeZone | encodeHost | encodePathSegment | encodePath,
	'4':  hexChar | encodeFragment | encodeQueryComponent | encodeUserPassword | encodeZone | encodeHost | encodePathSegment | encodePath,
	'5':  hexChar | encodeFragment | encodeQueryComponent | encodeUserPassword | encodeZone | encodeHost | encodePathSegment | encodePath,
	'6':  hexChar | encodeFragment | encodeQueryComponent | encodeUserPassword | encodeZone | encodeHost | encodePathSegment | encodePath,
	'7':  hexChar | encodeFragment | encodeQueryComponent | encodeUserPassword | encodeZone | encodeHost | encodePathSegment | encodePath,
	'8':  hexChar | encodeFragment | encodeQueryComponent | encodeUserPassword | encodeZone | encodeHost | encodePathSegment | encodePath,
	'9':  hexChar | encodeFragment | encodeQueryComponent | encodeUserPassword | encodeZone | encodeHost | encodePathSegment | encodePath,
	':':  encodeFragment | encodeZone | encodeHost | encodePathSegment | encodePath,
	';':  encodeFragment | encodeUserPassword | encodeZone | encodeHost | encodePath,
	'<':  encodeZone | encodeHost,
	'=':  encodeFragment | encodeUserPassword | encodeZone | encodeHost | encodePathSegment | encodePath,
	'>':  encodeZone | encodeHost,
	'?':  encodeFragment,
	'@':  encodeFragment | encodePathSegment | encodePath,
	'A':  hexChar | encodeFragment | encodeQueryComponent | encodeUserPassword | encodeZone | encodeHost | encodePathSegment | encodePath,
	'B':  hexChar | encodeFragment | encodeQueryComponent | encodeUserPassword | encodeZone | encodeHost | encodePathSegment | encodePath,
	'C':  hexChar | encodeFragment | encodeQueryComponent | encodeUserPassword | encodeZone | encodeHost | encodePathSegment | encodePath,
	'D':  hexChar | encodeFragment | encodeQueryComponent | encodeUserPassword | encodeZone | encodeHost | encodePathSegment | encodePath,
	'E':  hexChar | encodeFragment | encodeQueryComponent | encodeUserPassword | encodeZone | encodeHost | encodePathSegment | encodePath,
	'F':  hexChar | encodeFragment | encodeQueryComponent | encodeUserPassword | encodeZone | encodeHost | encodePathSegment | encodePath,
	'G':  encodeFragment | encodeQueryComponent | encodeUserPassword | encodeZone | encodeHost | encodePathSegment | encodePath,
	'H':  encodeFragment | encodeQueryComponent | encodeUserPassword | encodeZone | encodeHost | encodePathSegment | encodePath,
	'I':  encodeFragment | encodeQueryComponent | encodeUserPassword | encodeZone | encodeHost | encodePathSegment | encodePath,
	'J':  encodeFragment | encodeQueryComponent | encodeUserPassword | encodeZone | encodeHost | encodePathSegment | encodePath,
	'K':  encodeFragment | encodeQueryComponent | encodeUserPassword | encodeZone | encodeHost | encodePathSegment | encodePath,
	'L':  encodeFragment | encodeQueryComponent | encodeUserPassword | encodeZone | encodeHost | encodePathSegment | encodePath,
	'M':  encodeFragment | encodeQueryComponent | encodeUserPassword | encodeZone | encodeHost | encodePathSegment | encodePath,
	'N':  encodeFragment | encodeQueryComponent | encodeUserPassword | encodeZone | encodeHost | encodePathSegment | encodePath,
	'O':  encodeFragment | encodeQueryComponent | encodeUserPassword | encodeZone | encodeHost | encodePathSegment | encodePath,
	'P':  encodeFragment | encodeQueryComponent | encodeUserPassword | encodeZone | encodeHost | encodePathSegment | encodePath,
	'Q':  encodeFragment | encodeQueryComponent | encodeUserPassword | encodeZone | encodeHost | encodePathSegment | encodePath,
	'R':  encodeFragment | encodeQueryComponent | encodeUserPassword | encodeZone | encodeHost | encodePathSegment | encodePath,
	'S':  encodeFragment | encodeQueryComponent | encodeUserPassword | encodeZone | encodeHost | encodePathSegment | encodePath,
	'T':  encodeFragment | encodeQueryComponent | encodeUserPassword | encodeZone | encodeHost | encodePathSegment | encodePath,
	'U':  encodeFragment | encodeQueryComponent | encodeUserPassword | encodeZone | encodeHost | encodePathSegment | encodePath,
	'V':  encodeFragment | encodeQueryComponent | encodeUserPassword | encodeZone | encodeHost | encodePathSegment | encodePath,
	'W':  encodeFragment | encodeQueryComponent | encodeUserPassword | encodeZone | encodeHost | encodePathSegment | encodePath,
	'X':  encodeFragment | encodeQueryComponent | encodeUserPassword | encodeZone | encodeHost | encodePathSegment | encodePath,
	'Y':  encodeFragment | encodeQueryComponent | encodeUserPassword | encodeZone | encodeHost | encodePathSegment | encodePath,
	'Z':  encodeFragment | encodeQueryComponent | encodeUserPassword | encodeZone | encodeHost | encodePathSegment | encodePath,
	'[':  encodeZone | encodeHost,
	']':  encodeZone | encodeHost,
	'_':  encodeFragment | encodeQueryComponent | encodeUserPassword | encodeZone | encodeHost | encodePathSegment | encodePath,
	'a':  hexChar | encodeFragment | encodeQueryComponent | encodeUserPassword | encodeZone | encodeHost | encodePathSegment | encodePath,
	'b':  hexChar | encodeFragment | encodeQueryComponent | encodeUserPassword | encodeZone | encodeHost | encodePathSegment | encodePath,
	'c':  hexChar | encodeFragment | encodeQueryComponent | encodeUserPassword | encodeZone | encodeHost | encodePathSegment | encodePath,
	'd':  hexChar | encodeFragment | encodeQueryComponent | encodeUserPassword | encodeZone | encodeHost | encodePathSegment | encodePath,
	'e':  hexChar | encodeFragment | encodeQueryComponent | encodeUserPassword | encodeZone | encodeHost | encodePathSegment | encodePath,
	'f':  hexChar | encodeFragment | encodeQueryComponent | encodeUserPassword | encodeZone | encodeHost | encodePathSegment | encodePath,
	'g':  encodeFragment | encodeQueryComponent | encodeUserPassword | encodeZone | encodeHost | encodePathSegment | encodePath,
	'h':  encodeFragment | encodeQueryComponent | encodeUserPassword | encodeZone | encodeHost | encodePathSegment | encodePath,
	'i':  encodeFragment | encodeQueryComponent | encodeUserPassword | encodeZone | encodeHost | encodePathSegment | encodePath,
	'j':  encodeFragment | encodeQueryComponent | encodeUserPassword | encodeZone | encodeHost | encodePathSegment | encodePath,
	'k':  encodeFragment | encodeQueryComponent | encodeUserPassword | encodeZone | encodeHost | encodePathSegment | encodePath,
	'l':  encodeFragment | encodeQueryComponent | encodeUserPassword | encodeZone | encodeHost | encodePathSegment | encodePath,
	'm':  encodeFragment | encodeQueryComponent | encodeUserPassword | encodeZone | encodeHost | encodePathSegment | encodePath,
	'n':  encodeFragment | encodeQueryComponent | encodeUserPassword | encodeZone | encodeHost | encodePathSegment | encodePath,
	'o':  encodeFragment | encodeQueryComponent | encodeUserPassword | encodeZone | encodeHost | encodePathSegment | encodePath,
	'p':  encodeFragment | encodeQueryComponent | encodeUserPassword | encodeZone | encodeHost | encodePathSegment | encodePath,
	'q':  encodeFragment | encodeQueryComponent | encodeUserPassword | encodeZone | encodeHost | encodePathSegment | encodePath,
	'r':  encodeFragment | encodeQueryComponent | encodeUserPassword | encodeZone | encodeHost | encodePathSegment | encodePath,
	's':  encodeFragment | encodeQueryComponent | encodeUserPassword | encodeZone | encodeHost | encodePathSegment | encodePath,
	't':  encodeFragment | encodeQueryComponent | encodeUserPassword | encodeZone | encodeHost | encodePathSegment | encodePath,
	'u':  encodeFragment | encodeQueryComponent | encodeUserPassword | encodeZone | encodeHost | encodePathSegment | encodePath,
	'v':  encodeFragment | encodeQueryComponent | encodeUserPassword | encodeZone | encodeHost | encodePathSegment | encodePath,
	'w':  encodeFragment | encodeQueryComponent | encodeUserPassword | encodeZone | encodeHost | encodePathSegment | encodePath,
	'x':  encodeFragment | encodeQueryComponent | encodeUserPassword | encodeZone | encodeHost | encodePathSegment | encodePath,
	'y':  encodeFragment | encodeQueryComponent | encodeUserPassword | encodeZone | encodeHost | encodePathSegment | encodePath,
	'z':  encodeFragment | encodeQueryComponent | encodeUserPassword | encodeZone | encodeHost | encodePathSegment | encodePath,
	'~':  encodeFragment | encodeQueryComponent | encodeUserPassword | encodeZone | encodeHost | encodePathSegment | encodePath,
}

const upperhex = "0123456789ABCDEF"

func ishex(c byte) bool {
	return table[c]&hexChar != 0
}

func unhex(c byte) byte {
	return 9*(c>>6) + (c & 15)
}

type EscapeError string

func (e EscapeError) Error() string {
	return "invalid URL escape " + strconv.Quote(string(e))
}

type InvalidHostError string

func (e InvalidHostError) Error() string {
	return "invalid character " + strconv.Quote(string(e)) + " in host name"
}

func shouldEscape(c byte, mode encoding) bool {
	return table[c]&mode == 0
}

func QueryEscape(s string) string {
	return escape(s, encodeQueryComponent)
}

func PathEscape(s string) string {
	return escape(s, encodePathSegment)
}

func QueryUnescape(s string) (string, error) {
	res, err := unescape(s, encodeQueryComponent)
	return res, err
}

func PathUnescape(s string) (string, error) {
	res, err := unescape(s, encodePathSegment)
	return res, err
}

func escape(s string, mode encoding) string {
	b := []byte(s)
	spaceCount := 0
	hexCount := 0
	for _, c := range b {
		if shouldEscape(c, mode) {
			if c == ' ' && mode == encodeQueryComponent {
				spaceCount++
			} else {
				hexCount++
			}
		}
	}

	if spaceCount == 0 && hexCount == 0 {
		return s
	}

	required := len(b) + 2*hexCount
	t := make([]byte, required)

	if hexCount == 0 {
		copy(t, b)
		for i := 0; i < len(t); i++ {
			if t[i] == ' ' {
				t[i] = '+'
			}
		}
		return string(t)
	}

	j := 0
	for _, c := range b {
		if c == ' ' && mode == encodeQueryComponent {
			t[j] = '+'
			j++
		} else if shouldEscape(c, mode) {
			t[j] = '%'
			t[j+1] = byte(upperhex[c>>4])
			t[j+2] = byte(upperhex[c&15])
			j += 3
		} else {
			t[j] = c
			j++
		}
	}
	return string(t)
}

func validatePercent(b []byte, i int, mode encoding) (int, error) {
	if i+2 >= len(b) || !ishex(b[i+1]) || !ishex(b[i+2]) {
		sub := b[i:]
		if len(sub) > 3 {
			sub = sub[:3]
		}
		return 0, EscapeError(string(sub))
	}
	if mode == encodeHost && unhex(b[i+1]) < 8 && string(b[i:i+3]) != "%25" {
		return 0, EscapeError(string(b[i : i+3]))
	}
	if mode == encodeZone {
		v := byte(unhex(b[i+1])<<4 | unhex(b[i+2]))
		if string(b[i:i+3]) != "%25" && v != ' ' && shouldEscape(v, encodeHost) {
			return 0, EscapeError(string(b[i : i+3]))
		}
	}
	return 3, nil
}

func unescape(s string, mode encoding) (string, error) {
	b := []byte(s)
	n := 0
	hasPlus := false
	for i := 0; i < len(b); {
		switch b[i] {
		case '%':
			n++
			adv, err := validatePercent(b, i, mode)
			if err != nil {
				return "", err
			}
			i += adv
		case '+':
			hasPlus = mode == encodeQueryComponent
			i++
		default:
			if (mode == encodeHost || mode == encodeZone) && b[i] < 0x80 && shouldEscape(b[i], mode) {
				return "", InvalidHostError(string(b[i : i+1]))
			}
			i++
		}
	}

	if n == 0 && !hasPlus {
		return s, nil
	}

	unescapedPlusSign := byte('+')
	if mode == encodeQueryComponent {
		unescapedPlusSign = ' '
	}
	out := make([]byte, 0, len(b)-2*n)
	for i := 0; i < len(b); i++ {
		switch b[i] {
		case '%':
			out = append(out, byte(unhex(b[i+1])<<4|unhex(b[i+2])))
			i += 2
		case '+':
			out = append(out, unescapedPlusSign)
		default:
			out = append(out, b[i])
		}
	}
	return string(out), nil
}
