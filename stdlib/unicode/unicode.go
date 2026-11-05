//go:build gofront

//gofront:target both

package unicode

const (
	MaxRune         = '\U0010FFFF' // Maximum valid Unicode code point.
	ReplacementChar = '\uFFFD'     // Represents invalid code points.
	MaxASCII        = '\u007F'     // maximum ASCII value.
	MaxLatin1       = '\u00FF'     // maximum Latin-1 value.
	UpperLower      = MaxRune + 1
	Version         = "15.0.0"
)

// Classes of unicode_is, the host's answer for runes above ASCII.
const (
	classLetter = iota
	classDigit
	classSpace
	classUpper
	classLower
	classPunct
	classControl
	classPrint
	classGraphic
)

// hostIs reports whether the host's Unicode tables place r in the class.
//
//gofront:intrinsic unicode_is
func hostIs(r rune, class int) bool

// hostToUpper is the host's upper case mapping of r; a letter whose upper
// case spans several code points stays as it is.
//
//gofront:intrinsic unicode_to_upper
func hostToUpper(r rune) rune

// hostToLower is the host's lower case mapping of r.
//
//gofront:intrinsic unicode_to_lower
func hostToLower(r rune) rune

func isValid(r rune) bool { return r >= 0 && r <= MaxRune }

// IsLetter reports whether the rune is a letter (category L).
func IsLetter(r rune) bool {
	if r < 0x80 {
		return 'a' <= r && r <= 'z' || 'A' <= r && r <= 'Z'
	}
	return isValid(r) && hostIs(r, classLetter)
}

// IsDigit reports whether the rune is a decimal digit.
func IsDigit(r rune) bool {
	if r < 0x80 {
		return '0' <= r && r <= '9'
	}
	return isValid(r) && hostIs(r, classDigit)
}

// IsSpace reports whether the rune is a space character as defined by
// Unicode's White Space property.
func IsSpace(r rune) bool {
	if r < 0x80 {
		return r == ' ' || '\t' <= r && r <= '\r'
	}
	return isValid(r) && hostIs(r, classSpace)
}

// IsUpper reports whether the rune is an upper case letter.
func IsUpper(r rune) bool {
	if r < 0x80 {
		return 'A' <= r && r <= 'Z'
	}
	return isValid(r) && hostIs(r, classUpper)
}

// IsLower reports whether the rune is a lower case letter.
func IsLower(r rune) bool {
	if r < 0x80 {
		return 'a' <= r && r <= 'z'
	}
	return isValid(r) && hostIs(r, classLower)
}

// IsPunct reports whether the rune is a Unicode punctuation character
// (category P).
func IsPunct(r rune) bool {
	if r < 0x80 {
		switch r {
		case '!', '"', '#', '%', '&', '\'', '(', ')', '*', ',', '-', '.', '/',
			':', ';', '?', '@', '[', '\\', ']', '_', '{', '}':
			return true
		}
		return false
	}
	return isValid(r) && hostIs(r, classPunct)
}

// IsControl reports whether the rune is a control character.
func IsControl(r rune) bool {
	if r < 0x80 {
		return r >= 0 && r < ' ' || r == 0x7F
	}
	return isValid(r) && hostIs(r, classControl)
}

// IsPrint reports whether the rune is printable.
func IsPrint(r rune) bool {
	if r < 0x80 {
		return ' ' <= r && r <= '~'
	}
	return isValid(r) && hostIs(r, classPrint)
}

// IsGraphic reports whether the rune is a graphic character.
func IsGraphic(r rune) bool {
	if r < 0x80 {
		return ' ' <= r && r <= '~'
	}
	return isValid(r) && hostIs(r, classGraphic)
}

// ToUpper maps the rune to upper case.
func ToUpper(r rune) rune {
	if r < 0x80 {
		if 'a' <= r && r <= 'z' {
			return r - ('a' - 'A')
		}
		return r
	}
	if !isValid(r) {
		return r
	}
	return hostToUpper(r)
}

// ToLower maps the rune to lower case.
func ToLower(r rune) rune {
	if r < 0x80 {
		if 'A' <= r && r <= 'Z' {
			return r + ('a' - 'A')
		}
		return r
	}
	if !isValid(r) {
		return r
	}
	return hostToLower(r)
}

// ToTitle maps the rune to title case.
func ToTitle(r rune) rune {
	if r <= MaxASCII {
		if 'a' <= r && r <= 'z' {
			return r - ('a' - 'A')
		}
		return r
	}
	switch r {
	case 0x1C4, 0x1C5, 0x1C6:
		return 0x1C5
	case 0x1C7, 0x1C8, 0x1C9:
		return 0x1C8
	case 0x1CA, 0x1CB, 0x1CC:
		return 0x1CB
	case 0x1F1, 0x1F2, 0x1F3:
		return 0x1F2
	}
	if 0x10D0 <= r && r <= 0x10FF {
		return r
	}
	return ToUpper(r)
}

type foldPair struct {
	From uint16
	To   uint16
}

var caseOrbit = []foldPair{
	{0x004B, 0x006B}, {0x0053, 0x0073}, {0x006B, 0x212A}, {0x0073, 0x017F},
	{0x00B5, 0x039C}, {0x00C5, 0x00E5}, {0x00DF, 0x1E9E}, {0x00E5, 0x212B},
	{0x0130, 0x0130}, {0x0131, 0x0131}, {0x017F, 0x0053}, {0x01C4, 0x01C5},
	{0x01C5, 0x01C6}, {0x01C6, 0x01C4}, {0x01C7, 0x01C8}, {0x01C8, 0x01C9},
	{0x01C9, 0x01C7}, {0x01CA, 0x01CB}, {0x01CB, 0x01CC}, {0x01CC, 0x01CA},
	{0x01F1, 0x01F2}, {0x01F2, 0x01F3}, {0x01F3, 0x01F1}, {0x0345, 0x0399},
	{0x0392, 0x03B2}, {0x0395, 0x03B5}, {0x0398, 0x03B8}, {0x0399, 0x03B9},
	{0x039A, 0x03BA}, {0x039C, 0x03BC}, {0x03A0, 0x03C0}, {0x03A1, 0x03C1},
	{0x03A3, 0x03C2}, {0x03A6, 0x03C6}, {0x03A9, 0x03C9}, {0x03B2, 0x03D0},
	{0x03B5, 0x03F5}, {0x03B8, 0x03D1}, {0x03B9, 0x1FBE}, {0x03BA, 0x03F0},
	{0x03BC, 0x00B5}, {0x03C0, 0x03D6}, {0x03C1, 0x03F1}, {0x03C2, 0x03C3},
	{0x03C3, 0x03A3}, {0x03C6, 0x03D5}, {0x03C9, 0x2126}, {0x03D0, 0x0392},
	{0x03D1, 0x03F4}, {0x03D5, 0x03A6}, {0x03D6, 0x03A0}, {0x03F0, 0x039A},
	{0x03F1, 0x03A1}, {0x03F4, 0x0398}, {0x03F5, 0x0395}, {0x0412, 0x0432},
	{0x0414, 0x0434}, {0x041E, 0x043E}, {0x0421, 0x0441}, {0x0422, 0x0442},
	{0x042A, 0x044A}, {0x0432, 0x1C80}, {0x0434, 0x1C81}, {0x043E, 0x1C82},
	{0x0441, 0x1C83}, {0x0442, 0x1C84}, {0x044A, 0x1C86}, {0x0462, 0x0463},
	{0x0463, 0x1C87}, {0x1C80, 0x0412}, {0x1C81, 0x0414}, {0x1C82, 0x041E},
	{0x1C83, 0x0421}, {0x1C84, 0x1C85}, {0x1C85, 0x0422}, {0x1C86, 0x042A},
	{0x1C87, 0x0462}, {0x1C88, 0xA64A}, {0x1E60, 0x1E61}, {0x1E61, 0x1E9B},
	{0x1E9B, 0x1E60}, {0x1E9E, 0x00DF}, {0x1FBE, 0x0345}, {0x2126, 0x03A9},
	{0x212A, 0x004B}, {0x212B, 0x00C5}, {0xA64A, 0xA64B}, {0xA64B, 0x1C88},
}

func foldASCII(r rune) (rune, bool) {
	if 'a' <= r && r <= 'z' {
		if r != 'k' && r != 's' {
			return r - ('a' - 'A'), true
		}
	} else if 'A' <= r && r <= 'Z' {
		if r != 'K' && r != 'S' {
			return r + ('a' - 'A'), true
		}
	} else {
		return r, true
	}
	return r, false
}

// SimpleFold iterates over Unicode code points equivalent under simple case folding.
func SimpleFold(r rune) rune {
	if r < 0 || r > MaxRune {
		return r
	}
	if r < 128 {
		if folded, ok := foldASCII(r); ok {
			return folded
		}
	}
	lo := 0
	hi := len(caseOrbit)
	for lo < hi {
		m := int(uint(lo+hi) >> 1)
		if rune(caseOrbit[m].From) < r {
			lo = m + 1
		} else {
			hi = m
		}
	}
	if lo < len(caseOrbit) && rune(caseOrbit[lo].From) == r {
		return rune(caseOrbit[lo].To)
	}
	if l := ToLower(r); l != r {
		return l
	}
	return ToUpper(r)
}
