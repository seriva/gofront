package main

import (
	"encoding/csv"
	"errors"
	"fmt"
	"io"
	"strings"
	"unicode/utf8"
)

var errInvalidDelim = errors.New("csv: invalid field or comment delimiter")

type readTest struct {
	Name      string
	Input     string
	Output    [][]string
	Positions [][][2]int
	Errors    []error

	// These fields are copied into the Reader
	Comma              rune
	Comment            rune
	UseFieldsPerRecord bool // false (default) means FieldsPerRecord is -1
	FieldsPerRecord    int
	LazyQuotes         bool
	TrimLeadingSpace   bool
	ReuseRecord        bool
}

// In these tests, the §, ¶ and ∑ characters in readTest.Input are used to denote
// the start of a field, a record boundary and the position of an error respectively.
// They are removed before parsing and are used to verify the position
// information reported by FieldPos.

var readTests = []readTest{{
	Name:   "Simple",
	Input:  "§a,§b,§c\n",
	Output: [][]string{{"a", "b", "c"}},
}, {
	Name:   "CRLF",
	Input:  "§a,§b\r\n¶§c,§d\r\n",
	Output: [][]string{{"a", "b"}, {"c", "d"}},
}, {
	Name:   "BareCR",
	Input:  "§a,§b\rc,§d\r\n",
	Output: [][]string{{"a", "b\rc", "d"}},
}, {
	Name: "RFC4180test",
	Input: `§#field1,§field2,§field3
¶§"aaa",§"bb
b",§"ccc"
¶§"a,a",§"b""bb",§"ccc"
¶§zzz,§yyy,§xxx
`,
	Output: [][]string{
		{"#field1", "field2", "field3"},
		{"aaa", "bb\nb", "ccc"},
		{"a,a", `b"bb`, "ccc"},
		{"zzz", "yyy", "xxx"},
	},
	UseFieldsPerRecord: true,
	FieldsPerRecord:    0,
}, {
	Name:   "NoEOLTest",
	Input:  "§a,§b,§c",
	Output: [][]string{{"a", "b", "c"}},
}, {
	Name:   "Semicolon",
	Input:  "§a;§b;§c\n",
	Output: [][]string{{"a", "b", "c"}},
	Comma:  ';',
}, {
	Name: "MultiLine",
	Input: `§"two
line",§"one line",§"three
line
field"`,
	Output: [][]string{{"two\nline", "one line", "three\nline\nfield"}},
}, {
	Name:  "BlankLine",
	Input: "§a,§b,§c\n\n¶§d,§e,§f\n\n",
	Output: [][]string{
		{"a", "b", "c"},
		{"d", "e", "f"},
	},
}, {
	Name:  "BlankLineFieldCount",
	Input: "§a,§b,§c\n\n¶§d,§e,§f\n\n",
	Output: [][]string{
		{"a", "b", "c"},
		{"d", "e", "f"},
	},
	UseFieldsPerRecord: true,
	FieldsPerRecord:    0,
}, {
	Name:             "TrimSpace",
	Input:            " §a,  §b,   §c\n",
	Output:           [][]string{{"a", "b", "c"}},
	TrimLeadingSpace: true,
}, {
	Name:   "LeadingSpace",
	Input:  "§ a,§  b,§   c\n",
	Output: [][]string{{" a", "  b", "   c"}},
}, {
	Name:    "Comment",
	Input:   "#1,2,3\n§a,§b,§c\n#comment",
	Output:  [][]string{{"a", "b", "c"}},
	Comment: '#',
}, {
	Name:   "NoComment",
	Input:  "§#1,§2,§3\n¶§a,§b,§c",
	Output: [][]string{{"#1", "2", "3"}, {"a", "b", "c"}},
}, {
	Name:       "LazyQuotes",
	Input:      `§a "word",§"1"2",§a",§"b`,
	Output:     [][]string{{`a "word"`, `1"2`, `a"`, `b`}},
	LazyQuotes: true,
}, {
	Name:       "BareQuotes",
	Input:      `§a "word",§"1"2",§a"`,
	Output:     [][]string{{`a "word"`, `1"2`, `a"`}},
	LazyQuotes: true,
}, {
	Name:       "BareDoubleQuotes",
	Input:      `§a""b,§c`,
	Output:     [][]string{{`a""b`, `c`}},
	LazyQuotes: true,
}, {
	Name:   "BadDoubleQuotes",
	Input:  `§a∑""b,c`,
	Errors: []error{&csv.ParseError{Err: csv.ErrBareQuote}},
}, {
	Name:             "TrimQuote",
	Input:            ` §"a",§" b",§c`,
	Output:           [][]string{{"a", " b", "c"}},
	TrimLeadingSpace: true,
}, {
	Name:   "BadBareQuote",
	Input:  `§a ∑"word","b"`,
	Errors: []error{&csv.ParseError{Err: csv.ErrBareQuote}},
}, {
	Name:   "BadTrailingQuote",
	Input:  `§"a word",b∑"`,
	Errors: []error{&csv.ParseError{Err: csv.ErrBareQuote}},
}, {
	Name:   "ExtraneousQuote",
	Input:  `§"a ∑"word","b"`,
	Errors: []error{&csv.ParseError{Err: csv.ErrQuote}},
}, {
	Name:               "BadFieldCount",
	Input:              "§a,§b,§c\n¶∑§d,§e",
	Errors:             []error{nil, &csv.ParseError{Err: csv.ErrFieldCount}},
	Output:             [][]string{{"a", "b", "c"}, {"d", "e"}},
	UseFieldsPerRecord: true,
	FieldsPerRecord:    0,
}, {
	Name:               "BadFieldCountMultiple",
	Input:              "§a,§b,§c\n¶∑§d,§e\n¶∑§f",
	Errors:             []error{nil, &csv.ParseError{Err: csv.ErrFieldCount}, &csv.ParseError{Err: csv.ErrFieldCount}},
	Output:             [][]string{{"a", "b", "c"}, {"d", "e"}, {"f"}},
	UseFieldsPerRecord: true,
	FieldsPerRecord:    0,
}, {
	Name:               "BadFieldCount1",
	Input:              `§∑a,§b,§c`,
	Errors:             []error{&csv.ParseError{Err: csv.ErrFieldCount}},
	Output:             [][]string{{"a", "b", "c"}},
	UseFieldsPerRecord: true,
	FieldsPerRecord:    2,
}, {
	Name:   "FieldCount",
	Input:  "§a,§b,§c\n¶§d,§e",
	Output: [][]string{{"a", "b", "c"}, {"d", "e"}},
}, {
	Name:   "TrailingCommaEOF",
	Input:  "§a,§b,§c,§",
	Output: [][]string{{"a", "b", "c", ""}},
}, {
	Name:   "TrailingCommaEOL",
	Input:  "§a,§b,§c,§\n",
	Output: [][]string{{"a", "b", "c", ""}},
}, {
	Name:             "TrailingCommaSpaceEOF",
	Input:            "§a,§b,§c, §",
	Output:           [][]string{{"a", "b", "c", ""}},
	TrimLeadingSpace: true,
}, {
	Name:             "TrailingCommaSpaceEOL",
	Input:            "§a,§b,§c, §\n",
	Output:           [][]string{{"a", "b", "c", ""}},
	TrimLeadingSpace: true,
}, {
	Name:             "TrailingCommaLine3",
	Input:            "§a,§b,§c\n¶§d,§e,§f\n¶§g,§hi,§",
	Output:           [][]string{{"a", "b", "c"}, {"d", "e", "f"}, {"g", "hi", ""}},
	TrimLeadingSpace: true,
}, {
	Name:   "NotTrailingComma3",
	Input:  "§a,§b,§c,§ \n",
	Output: [][]string{{"a", "b", "c", " "}},
}, {
	Name: "CommaFieldTest",
	Input: `§x,§y,§z,§w
¶§x,§y,§z,§
¶§x,§y,§,§
¶§x,§,§,§
¶§,§,§,§
¶§"x",§"y",§"z",§"w"
¶§"x",§"y",§"z",§""
¶§"x",§"y",§"",§""
¶§"x",§"",§"",§""
¶§"",§"",§"",§""
`,
	Output: [][]string{
		{"x", "y", "z", "w"},
		{"x", "y", "z", ""},
		{"x", "y", "", ""},
		{"x", "", "", ""},
		{"", "", "", ""},
		{"x", "y", "z", "w"},
		{"x", "y", "z", ""},
		{"x", "y", "", ""},
		{"x", "", "", ""},
		{"", "", "", ""},
	},
}, {
	Name:  "TrailingCommaIneffective1",
	Input: "§a,§b,§\n¶§c,§d,§e",
	Output: [][]string{
		{"a", "b", ""},
		{"c", "d", "e"},
	},
	TrimLeadingSpace: true,
}, {
	Name:  "ReadAllReuseRecord",
	Input: "§a,§b\n¶§c,§d",
	Output: [][]string{
		{"a", "b"},
		{"c", "d"},
	},
	ReuseRecord: true,
}, {
	Name:   "StartLine1", // Issue 19019
	Input:  "§a,\"b\nc∑\"d,e",
	Errors: []error{&csv.ParseError{Err: csv.ErrQuote}},
}, {
	Name:   "StartLine2",
	Input:  "§a,§b\n¶§\"d\n\n,e∑",
	Errors: []error{nil, &csv.ParseError{Err: csv.ErrQuote}},
	Output: [][]string{{"a", "b"}},
}, {
	Name:  "CRLFInQuotedField", // Issue 21201
	Input: "§A,§\"Hello\r\nHi\",§B\r\n",
	Output: [][]string{
		{"A", "Hello\nHi", "B"},
	},
}, {
	Name:   "TrailingCR",
	Input:  "§field1,§field2\r",
	Output: [][]string{{"field1", "field2"}},
}, {
	Name:   "QuotedTrailingCR",
	Input:  "§\"field\"\r",
	Output: [][]string{{"field"}},
}, {
	Name:   "QuotedTrailingCRCR",
	Input:  "§\"field∑\"\r\r",
	Errors: []error{&csv.ParseError{Err: csv.ErrQuote}},
}, {
	Name:   "FieldCR",
	Input:  "§field\rfield\r",
	Output: [][]string{{"field\rfield"}},
}, {
	Name:   "FieldCRCR",
	Input:  "§field\r\rfield\r\r",
	Output: [][]string{{"field\r\rfield\r"}},
}, {
	Name:   "FieldCRCRLF",
	Input:  "§field\r\r\n¶§field\r\r\n",
	Output: [][]string{{"field\r"}, {"field\r"}},
}, {
	Name:   "FieldCRCRLFCR",
	Input:  "§field\r\r\n¶§\rfield\r\r\n\r",
	Output: [][]string{{"field\r"}, {"\rfield\r"}},
}, {
	Name:   "FieldCRCRLFCRCR",
	Input:  "§field\r\r\n¶§\r\rfield\r\r\n¶§\r\r",
	Output: [][]string{{"field\r"}, {"\r\rfield\r"}, {"\r"}},
}, {
	Name:  "MultiFieldCRCRLFCRCR",
	Input: "§field1,§field2\r\r\n¶§\r\rfield1,§field2\r\r\n¶§\r\r,§",
	Output: [][]string{
		{"field1", "field2\r"},
		{"\r\rfield1", "field2\r"},
		{"\r\r", ""},
	},
}, {
	Name:             "NonASCIICommaAndComment",
	Input:            "§a£§b,c£ \t§d,e\n€ comment\n",
	Output:           [][]string{{"a", "b,c", "d,e"}},
	TrimLeadingSpace: true,
	Comma:            '£',
	Comment:          '€',
}, {
	Name:    "NonASCIICommaAndCommentWithQuotes",
	Input:   "§a€§\"  b,\"€§ c\nλ comment\n",
	Output:  [][]string{{"a", "  b,", " c"}},
	Comma:   '€',
	Comment: 'λ',
}, {
	// λ and θ start with the same byte.
	// This tests that the parser doesn't confuse such characters.
	Name:    "NonASCIICommaConfusion",
	Input:   "§\"abθcd\"λ§efθgh",
	Output:  [][]string{{"abθcd", "efθgh"}},
	Comma:   'λ',
	Comment: '€',
}, {
	Name:    "NonASCIICommentConfusion",
	Input:   "§λ\n¶§λ\nθ\n¶§λ\n",
	Output:  [][]string{{"λ"}, {"λ"}, {"λ"}},
	Comment: 'θ',
}, {
	Name:   "QuotedFieldMultipleLF",
	Input:  "§\"\n\n\n\n\"",
	Output: [][]string{{"\n\n\n\n"}},
}, {
	Name:  "MultipleCRLF",
	Input: "\r\n\r\n\r\n\r\n",
}, {
	// The implementation may read each line in several chunks if it doesn't fit entirely
	// in the read buffer, so we should test the code to handle that condition.
	Name:    "HugeLines",
	Input:   strings.Repeat("#ignore\n", 10000) + "§" + strings.Repeat("@", 5000) + ",§" + strings.Repeat("*", 5000),
	Output:  [][]string{{strings.Repeat("@", 5000), strings.Repeat("*", 5000)}},
	Comment: '#',
}, {
	Name:   "QuoteWithTrailingCRLF",
	Input:  "§\"foo∑\"bar\"\r\n",
	Errors: []error{&csv.ParseError{Err: csv.ErrQuote}},
}, {
	Name:       "LazyQuoteWithTrailingCRLF",
	Input:      "§\"foo\"bar\"\r\n",
	Output:     [][]string{{`foo"bar`}},
	LazyQuotes: true,
}, {
	Name:   "DoubleQuoteWithTrailingCRLF",
	Input:  "§\"foo\"\"bar\"\r\n",
	Output: [][]string{{`foo"bar`}},
}, {
	Name:   "EvenQuotes",
	Input:  `§""""""""`,
	Output: [][]string{{`"""`}},
}, {
	Name:   "OddQuotes",
	Input:  `§"""""""∑`,
	Errors: []error{&csv.ParseError{Err: csv.ErrQuote}},
}, {
	Name:       "LazyOddQuotes",
	Input:      `§"""""""`,
	Output:     [][]string{{`"""`}},
	LazyQuotes: true,
}, {
	Name:   "BadComma1",
	Comma:  '\n',
	Errors: []error{errInvalidDelim},
}, {
	Name:   "BadComma2",
	Comma:  '\r',
	Errors: []error{errInvalidDelim},
}, {
	Name:   "BadComma3",
	Comma:  '"',
	Errors: []error{errInvalidDelim},
}, {
	Name:   "BadComma4",
	Comma:  utf8.RuneError,
	Errors: []error{errInvalidDelim},
}, {
	Name:    "BadComment1",
	Comment: '\n',
	Errors:  []error{errInvalidDelim},
}, {
	Name:    "BadComment2",
	Comment: '\r',
	Errors:  []error{errInvalidDelim},
}, {
	Name:    "BadComment3",
	Comment: utf8.RuneError,
	Errors:  []error{errInvalidDelim},
}, {
	Name:    "BadCommaComment",
	Comma:   'X',
	Comment: 'X',
	Errors:  []error{errInvalidDelim},
}}


// makePositions returns the expected field positions of all the fields in
// text, the positions of any errors, and the text with the position markers
// removed. § starts a field, ¶ separates records and ∑ marks an error.
func makePositions(text string) ([][][2]int, map[int][2]int, string) {
	src := []byte(text)
	buf := make([]byte, 0, len(src))
	var positions [][][2]int
	errPositions := make(map[int][2]int)
	line, col := 1, 1
	recNum := 0

	for len(src) > 0 {
		r, size := utf8.DecodeRune(src)
		switch r {
		case '\n':
			line++
			col = 1
			buf = append(buf, '\n')
		case '§':
			if len(positions) == 0 {
				positions = append(positions, [][2]int{})
			}
			positions[len(positions)-1] = append(positions[len(positions)-1], [2]int{line, col})
		case '¶':
			positions = append(positions, [][2]int{})
			recNum++
		case '∑':
			errPositions[recNum] = [2]int{line, col}
		default:
			buf = append(buf, src[:size]...)
			col += size
		}
		src = src[size:]
	}
	return positions, errPositions, string(buf)
}

func newReader(tt readTest) (*csv.Reader, string) {
	_, _, input := makePositions(tt.Input)
	r := csv.NewReader(strings.NewReader(input))
	if tt.Comma != 0 {
		r.Comma = tt.Comma
	}
	r.Comment = tt.Comment
	if tt.UseFieldsPerRecord {
		r.FieldsPerRecord = tt.FieldsPerRecord
	} else {
		r.FieldsPerRecord = -1
	}
	r.LazyQuotes = tt.LazyQuotes
	r.TrimLeadingSpace = tt.TrimLeadingSpace
	r.ReuseRecord = tt.ReuseRecord
	return r, input
}

// quoteRec and quoteAll print a nil slice as [] (GoFront prints %q of nil as "").
func quoteRec(rec []string) string {
	if rec == nil {
		return "[]"
	}
	return fmt.Sprintf("%q", rec)
}

func quoteAll(out [][]string) string {
	if out == nil {
		return "[]"
	}
	return fmt.Sprintf("%q", out)
}

func describe(err error) string {
	if err == nil {
		return "<nil>"
	}
	if pe, ok := err.(*csv.ParseError); ok {
		return fmt.Sprintf("ParseError{start=%d line=%d col=%d err=%v is=%v/%v/%v/%v} %q", pe.StartLine, pe.Line, pe.Column, pe.Err,
			errors.Is(err, csv.ErrBareQuote), errors.Is(err, csv.ErrQuote), errors.Is(err, csv.ErrFieldCount), errors.Is(err, io.EOF), err.Error())
	}
	return err.Error()
}

func main() {
	for _, tt := range readTests {
		fmt.Println("==", tt.Name)
		positions, _, _ := makePositions(tt.Input)
		r, input := newReader(tt)
		out, err := r.ReadAll()
		fmt.Printf("ReadAll: %s err=%s\n", quoteAll(out), describe(err))
		fmt.Printf("offset=%d len=%d\n", r.InputOffset(), len([]byte(input)))

		r, _ = newReader(tt)
		for recNum := 0; recNum < 100; recNum++ {
			rec, err := r.Read()
			fmt.Printf("Read %d: %s err=%s\n", recNum, quoteRec(rec), describe(err))
			if err != nil && !errors.Is(err, csv.ErrFieldCount) {
				break
			}
			for i := range rec {
				line, col := r.FieldPos(i)
				want := [2]int{-1, -1}
				if recNum < len(positions) && i < len(positions[recNum]) {
					want = positions[recNum][i]
				}
				fmt.Printf("  field %d at %d:%d want %v\n", i, line, col, want)
			}
			fmt.Printf("  offset=%d\n", r.InputOffset())
		}
	}
}
