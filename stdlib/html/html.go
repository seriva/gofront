//go:build gofront

//gofront:target both

// Copyright 2010 The Go Authors. All rights reserved.
// Use of this source code is governed by a BSD-style
// license that can be found in the LICENSE file.

// Package html provides functions for escaping and unescaping HTML text.
//
// UnescapeString follows Go's algorithm for numeric references (including the
// Windows-1252 replacement table) and for named references without a
// semicolon, but knows a subset of Go's 2,231 entity names: the five that
// EscapeString produces and apos, the 96 HTML 4 Latin-1 names (nbsp through
// yuml) and these others: euro, hellip, mdash, ndash, lsquo, rsquo, sbquo,
// ldquo, rdquo, bdquo, bull, trade, larr, rarr, uarr, darr, harr, hearts,
// spades, clubs and diams. An unknown name is left as it is.
package html

var replacementTable = [...]rune{
	'\u20AC', // First entry is what 0x80 should be replaced with.
	'\u0081',
	'\u201A',
	'\u0192',
	'\u201E',
	'\u2026',
	'\u2020',
	'\u2021',
	'\u02C6',
	'\u2030',
	'\u0160',
	'\u2039',
	'\u0152',
	'\u008D',
	'\u017D',
	'\u008F',
	'\u0090',
	'\u2018',
	'\u2019',
	'\u201C',
	'\u201D',
	'\u2022',
	'\u2013',
	'\u2014',
	'\u02DC',
	'\u2122',
	'\u0161',
	'\u203A',
	'\u0153',
	'\u009D',
	'\u017E',
	'\u0178', // Last entry is 0x9F.
	// 0x00->'\uFFFD' is handled programmatically.
	// 0x0D->'\u000D' is a no-op.
}

// latin1 holds the HTML 4 names of the runes U+00A0 through U+00FF, in order.
var latin1 = [...]string{
	"nbsp", "iexcl", "cent", "pound", "curren", "yen", "brvbar", "sect",
	"uml", "copy", "ordf", "laquo", "not", "shy", "reg", "macr",
	"deg", "plusmn", "sup2", "sup3", "acute", "micro", "para", "middot",
	"cedil", "sup1", "ordm", "raquo", "frac14", "frac12", "frac34", "iquest",
	"Agrave", "Aacute", "Acirc", "Atilde", "Auml", "Aring", "AElig", "Ccedil",
	"Egrave", "Eacute", "Ecirc", "Euml", "Igrave", "Iacute", "Icirc", "Iuml",
	"ETH", "Ntilde", "Ograve", "Oacute", "Ocirc", "Otilde", "Ouml", "times",
	"Oslash", "Ugrave", "Uacute", "Ucirc", "Uuml", "Yacute", "THORN", "szlig",
	"agrave", "aacute", "acirc", "atilde", "auml", "aring", "aelig", "ccedil",
	"egrave", "eacute", "ecirc", "euml", "igrave", "iacute", "icirc", "iuml",
	"eth", "ntilde", "ograve", "oacute", "ocirc", "otilde", "ouml", "divide",
	"oslash", "ugrave", "uacute", "ucirc", "uuml", "yacute", "thorn", "yuml",
}

// longestEntityWithoutSemicolon is the length of the longest name that may
// appear without its closing semicolon.
const longestEntityWithoutSemicolon = 6

// entities is the entity table: every name with its semicolon, and the
// legacy names (the Latin-1 ones, amp, lt, gt and quot) without it too.
var entities = makeEntities()

func makeEntities() map[string]rune {
	m := make(map[string]rune)
	for i, name := range latin1 {
		m[name+";"] = rune(0xA0 + i)
		m[name] = rune(0xA0 + i)
	}
	for name, r := range map[string]rune{"amp": '&', "lt": '<', "gt": '>', "quot": '"'} {
		m[name+";"] = r
		m[name] = r
	}
	for name, r := range map[string]rune{
		"apos": '\'', "euro": 0x20AC, "hellip": 0x2026, "mdash": 0x2014,
		"ndash": 0x2013, "lsquo": 0x2018, "rsquo": 0x2019, "sbquo": 0x201A,
		"ldquo": 0x201C, "rdquo": 0x201D, "bdquo": 0x201E, "bull": 0x2022,
		"trade": 0x2122, "larr": 0x2190, "uarr": 0x2191, "rarr": 0x2192,
		"darr": 0x2193, "harr": 0x2194, "spades": 0x2660, "clubs": 0x2663,
		"hearts": 0x2665, "diams": 0x2666,
	} {
		m[name+";"] = r
	}
	return m
}

// unescapeEntity reads an entity like "&lt;" at the start of s (s[0] is '&')
// and returns the text it stands for and how many code units it spans. A
// reference it does not know stands for itself, one unit long.
func unescapeEntity(s string) (text string, n int) {
	if len(s) <= 1 {
		return "&", 1
	}
	i := 1
	if s[i] == '#' {
		if len(s) <= 3 { // We need to have at least "&#.".
			return "&", 1
		}
		i++
		c := s[i]
		hex := false
		if c == 'x' || c == 'X' {
			hex = true
			i++
		}

		var x rune
		for i < len(s) {
			c = s[i]
			i++
			if hex {
				if '0' <= c && c <= '9' {
					x = 16*x + rune(c) - '0'
					continue
				} else if 'a' <= c && c <= 'f' {
					x = 16*x + rune(c) - 'a' + 10
					continue
				} else if 'A' <= c && c <= 'F' {
					x = 16*x + rune(c) - 'A' + 10
					continue
				}
			} else if '0' <= c && c <= '9' {
				x = 10*x + rune(c) - '0'
				continue
			}
			if c != ';' {
				i--
			}
			break
		}

		if i <= 3 { // No characters matched.
			return "&", 1
		}

		if 0x80 <= x && x <= 0x9F {
			// Replace characters from Windows-1252 with UTF-8 equivalents.
			x = replacementTable[x-0x80]
		} else if x == 0 || (0xD800 <= x && x <= 0xDFFF) || x < 0 || x > 0x10FFFF {
			// Replace invalid characters with the replacement character.
			x = '\uFFFD'
		}
		return string(x), i
	}

	// Consume the maximum number of characters possible, with the
	// consumed characters matching one of the named references.
	for i < len(s) {
		c := s[i]
		i++
		if 'a' <= c && c <= 'z' || 'A' <= c && c <= 'Z' || '0' <= c && c <= '9' {
			continue
		}
		if c != ';' {
			i--
		}
		break
	}

	entityName := s[1:i]
	if len(entityName) == 0 {
		return "&", 1
	}
	entity := entities
	if x := entity[entityName]; x != 0 {
		return string(x), i
	}
	maxLen := len(entityName) - 1
	if maxLen > longestEntityWithoutSemicolon {
		maxLen = longestEntityWithoutSemicolon
	}
	for j := maxLen; j > 1; j-- {
		if x := entity[entityName[:j]]; x != 0 {
			return string(x), j + 1
		}
	}
	return s[:i], i
}

// EscapeString escapes special characters like "<" to become "&lt;". It
// escapes only five such characters: <, >, &, ' and ".
// [UnescapeString](EscapeString(s)) == s always holds, but the converse isn't
// always true.
func EscapeString(s string) string {
	out := ""
	last := 0
	for i := 0; i < len(s); i++ {
		var rep string
		switch s[i] {
		case '&':
			rep = "&amp;"
		case '\'':
			rep = "&#39;" // "&#39;" is shorter than "&apos;" and apos was not in HTML until HTML5.
		case '<':
			rep = "&lt;"
		case '>':
			rep = "&gt;"
		case '"':
			rep = "&#34;" // "&#34;" is shorter than "&quot;".
		default:
			continue
		}
		out += s[last:i] + rep
		last = i + 1
	}
	if last == 0 {
		return s
	}
	return out + s[last:]
}

// UnescapeString unescapes entities like "&lt;" to become "<". It unescapes a
// larger range of entities than [EscapeString] escapes. For example, "&aacute;"
// unescapes to "á", as does "&#225;" and "&#xE1;".
// UnescapeString([EscapeString](s)) == s always holds, but the converse isn't
// always true.
func UnescapeString(s string) string {
	out := ""
	last := 0
	for i := 0; i < len(s); {
		if s[i] != '&' {
			i++
			continue
		}
		text, n := unescapeEntity(s[i:])
		out += s[last:i] + text
		i += n
		last = i
	}
	if last == 0 {
		return s
	}
	return out + s[last:]
}
