package main

import (
	"encoding/csv"
	"fmt"
)

type writeTest struct {
	Input   [][]string
	Output  string
	Error   error
	UseCRLF bool
	Comma   rune
}

var writeTests = []writeTest{
	{Input: [][]string{{"abc"}}, Output: "abc\n"},
	{Input: [][]string{{"abc"}}, Output: "abc\r\n", UseCRLF: true},
	{Input: [][]string{{`"abc"`}}, Output: `"""abc"""` + "\n"},
	{Input: [][]string{{`a"b`}}, Output: `"a""b"` + "\n"},
	{Input: [][]string{{`"a"b"`}}, Output: `"""a""b"""` + "\n"},
	{Input: [][]string{{" abc"}}, Output: `" abc"` + "\n"},
	{Input: [][]string{{"abc,def"}}, Output: `"abc,def"` + "\n"},
	{Input: [][]string{{"abc", "def"}}, Output: "abc,def\n"},
	{Input: [][]string{{"abc"}, {"def"}}, Output: "abc\ndef\n"},
	{Input: [][]string{{"abc\ndef"}}, Output: "\"abc\ndef\"\n"},
	{Input: [][]string{{"abc\ndef"}}, Output: "\"abc\r\ndef\"\r\n", UseCRLF: true},
	{Input: [][]string{{"abc\rdef"}}, Output: "\"abcdef\"\r\n", UseCRLF: true},
	{Input: [][]string{{"abc\rdef"}}, Output: "\"abc\rdef\"\n", UseCRLF: false},
	{Input: [][]string{{""}}, Output: "\n"},
	{Input: [][]string{{"", ""}}, Output: ",\n"},
	{Input: [][]string{{"", "", ""}}, Output: ",,\n"},
	{Input: [][]string{{"", "", "a"}}, Output: ",,a\n"},
	{Input: [][]string{{"", "a", ""}}, Output: ",a,\n"},
	{Input: [][]string{{"", "a", "a"}}, Output: ",a,a\n"},
	{Input: [][]string{{"a", "", ""}}, Output: "a,,\n"},
	{Input: [][]string{{"a", "", "a"}}, Output: "a,,a\n"},
	{Input: [][]string{{"a", "a", ""}}, Output: "a,a,\n"},
	{Input: [][]string{{"a", "a", "a"}}, Output: "a,a,a\n"},
	{Input: [][]string{{"héllo", "wörld, ok", "日本 語"}, {"€", " €"}}, Output: "héllo,\"wörld, ok\",日本 語\n€,\" €\"\n"},
	{Input: [][]string{{`\.`}}, Output: "\"\\.\"\n"},
	{Input: [][]string{{"a", "a", ""}}, Output: "a|a|\n", Comma: '|'},
	{Input: [][]string{{",", ",", ""}}, Output: ",|,|\n", Comma: '|'},
}

// sink collects what the Writer writes (io.Writer).
type sink struct{ buf []byte }

func (s *sink) Write(p []byte) (int, error) {
	s.buf = append(s.buf, p...)
	return len(p), nil
}

func (s *sink) String() string { return string(s.buf) }

func main() {
	for n, tt := range writeTests {
		var b sink
		w := csv.NewWriter(&b)
		w.UseCRLF = tt.UseCRLF
		if tt.Comma != 0 {
			w.Comma = tt.Comma
		}
		err := w.WriteAll(tt.Input)
		fmt.Printf("%d: err=%v out=%q match=%v\n", n, err, b.String(), b.String() == tt.Output)
	}

	var b sink
	w := csv.NewWriter(&b)
	w.Write([]string{"a", "b c", "d,e"})
	w.Write([]string{"q\"uote", "", " lead"})
	w.Flush()
	fmt.Printf("%q %v\n", b.String(), w.Error())

	var b2 sink
	w2 := csv.NewWriter(&b2)
	w2.Comma = '\n'
	fmt.Println(w2.Write([]string{"a"}))
	w2.Comma = '\r'
	fmt.Println(w2.Write([]string{"a"}))
	w2.Comma = 0xfffd
	fmt.Println(w2.Write([]string{"a"}))
}
