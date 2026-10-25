//go:build gofront

//gofront:target both

package unicode

const (
	MaxRune         = '\U0010FFFF' // Maximum valid Unicode code point.
	ReplacementChar = '\uFFFD'     // Represents invalid code points.
	MaxASCII        = '\u007F'     // maximum ASCII value.
	MaxLatin1       = '\u00FF'     // maximum Latin-1 value.
	UpperCase       = 0
	LowerCase       = 1
	TitleCase       = 2
	MaxCase         = 3
	UpperLower      = MaxRune + 1
	Version         = "15.0.0"
)

// RangeTable defines a set of Unicode code points by listing ranges of code points.
type RangeTable struct {
	R16         []Range16
	R32         []Range32
	LatinOffset int
}

// Range16 represents a range of 16-bit Unicode code points.
type Range16 struct {
	Lo     uint16
	Hi     uint16
	Stride uint16
}

// Range32 represents a range of Unicode code points.
type Range32 struct {
	Lo     uint32
	Hi     uint32
	Stride uint32
}

func is16(ranges []Range16, r uint16) bool {
	lo := 0
	hi := len(ranges)
	for lo < hi {
		m := int(uint(lo+hi) >> 1)
		range_ := &ranges[m]
		if range_.Lo <= r && r <= range_.Hi {
			return range_.Stride == 1 || (r-range_.Lo)%range_.Stride == 0
		}
		if r < range_.Lo {
			hi = m
		} else {
			lo = m + 1
		}
	}
	return false
}

func is32(ranges []Range32, r uint32) bool {
	lo := 0
	hi := len(ranges)
	for lo < hi {
		m := int(uint(lo+hi) >> 1)
		range_ := ranges[m]
		if range_.Lo <= r && r <= range_.Hi {
			return range_.Stride == 1 || (r-range_.Lo)%range_.Stride == 0
		}
		if r < range_.Lo {
			hi = m
		} else {
			lo = m + 1
		}
	}
	return false
}

// Is reports whether the rune is in the specified table of ranges.
func Is(rangeTab *RangeTable, r rune) bool {
	if rangeTab == nil {
		return false
	}
	r16 := rangeTab.R16
	if len(r16) > 0 && uint32(r) <= uint32(r16[len(r16)-1].Hi) {
		return is16(r16, uint16(r))
	}
	r32 := rangeTab.R32
	if len(r32) > 0 && uint32(r) >= r32[0].Lo && uint32(r) <= r32[len(r32)-1].Hi {
		return is32(r32, uint32(r))
	}
	return false
}

// In reports whether the rune is a member of one of the ranges.
func In(r rune, ranges ...*RangeTable) bool {
	for _, inside := range ranges {
		if Is(inside, r) {
			return true
		}
	}
	return false
}

// IsOneOf reports whether the rune is a member of one of the ranges.
func IsOneOf(ranges []*RangeTable, r rune) bool {
	for _, inside := range ranges {
		if Is(inside, r) {
			return true
		}
	}
	return false
}

// IsMark reports whether the rune is a mark character (category M).
func IsMark(r rune) bool {
	return Is(Mark, r)
}

// IsNumber reports whether the rune is a number (category N).
func IsNumber(r rune) bool {
	return Is(Number, r)
}

// IsSymbol reports whether the rune is a symbolic character (category S).
func IsSymbol(r rune) bool {
	return Is(Symbol, r)
}

// IsTitle reports whether the rune is a title case letter.
func IsTitle(r rune) bool {
	if r <= MaxLatin1 {
		return false
	}
	switch r {
	case 0x1C5, 0x1C8, 0x1CB, 0x1F2, 0x1FBC, 0x1FCC, 0x1FFC:
		return true
	}
	if (0x1F88 <= r && r <= 0x1F8F) || (0x1F98 <= r && r <= 0x1F9F) || (0x1FA8 <= r && r <= 0x1FAF) {
		return true
	}
	return false
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
	return rune(ToUpper(int(r)))
}

// To maps the rune to the specified case: UpperCase, LowerCase, or TitleCase.
func To(case_ int, r rune) rune {
	switch case_ {
	case UpperCase:
		return rune(ToUpper(int(r)))
	case LowerCase:
		return rune(ToLower(int(r)))
	case TitleCase:
		return ToTitle(r)
	default:
		return ReplacementChar
	}
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
	if l := rune(ToLower(int(r))); l != r {
		return l
	}
	return rune(ToUpper(int(r)))
}
