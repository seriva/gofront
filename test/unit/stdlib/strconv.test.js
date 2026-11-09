// GoFront test suite — strconv (Go-source)
//
// Every case runs four ways (JS and WASM, natives on and off) and must print
// what the real Go toolchain printed for the same program.

import { assertFourWay, section, test } from "../helpers.js";

section("strconv (Go-source)");

test("integers, bools, errors and the append forms", async () => {
	await assertFourWay(
		`package main

import (
	"errors"
	"fmt"
	"math"
	"strconv"
)

func main() {
	fmt.Println(strconv.Itoa(0), strconv.Itoa(-45), strconv.Itoa(1<<40), strconv.IntSize)
	for _, s := range []string{"123", "-45", "+7", "", "abc", "12a", "1_000", " 1"} {
		n, err := strconv.Atoi(s)
		fmt.Println(n, err)
	}
	for _, c := range []struct {
		s    string
		base int
		bits int
	}{
		{"ff", 16, 64}, {"-ff", 16, 64}, {"0xff", 0, 64}, {"0b101", 0, 8}, {"0o17", 0, 64}, {"017", 0, 64},
		{"1_000", 0, 64}, {"1__0", 0, 64}, {"_1", 0, 64}, {"zz", 36, 64}, {"ZZ", 36, 64}, {"12", 2, 64},
		{"128", 10, 8}, {"-129", 10, 8}, {"127", 10, 8}, {"-128", 10, 8}, {"32768", 10, 16}, {"2147483648", 10, 32},
		{"9223372036854775807", 10, 64}, {"9223372036854775808", 10, 64}, {"-9223372036854775808", 10, 64},
		{"-9223372036854775809", 10, 64}, {"1", 1, 64}, {"1", 37, 64}, {"1", 10, 65}, {"1", 10, -1}, {"", 10, 64}, {"-", 10, 64},
	} {
		v, err := strconv.ParseInt(c.s, c.base, c.bits)
		fmt.Println(c.s, c.base, c.bits, "->", v, err)
	}
	for _, c := range []struct {
		s    string
		base int
		bits int
	}{
		{"18446744073709551615", 10, 64}, {"18446744073709551616", 10, 64}, {"-1", 10, 64}, {"+1", 10, 64},
		{"255", 10, 8}, {"256", 10, 8}, {"ffffffffffffffff", 16, 64}, {"10000000000000000", 16, 64}, {"0x1f", 0, 64},
	} {
		v, err := strconv.ParseUint(c.s, c.base, c.bits)
		fmt.Println(c.s, c.base, c.bits, "->", v, err)
	}
	_, err := strconv.ParseInt("300", 10, 8)
	var ne *strconv.NumError
	fmt.Println(errors.Is(err, strconv.ErrRange), errors.Is(err, strconv.ErrSyntax), errors.As(err, &ne))
	fmt.Println(ne.Func, ne.Num, ne.Err == strconv.ErrRange, errors.Unwrap(err) == strconv.ErrRange)
	_, err = strconv.Atoi("x")
	fmt.Println(errors.Is(err, strconv.ErrSyntax), err)
	fmt.Println(strconv.ErrRange, strconv.ErrSyntax)

	for _, s := range []string{"1", "t", "T", "TRUE", "true", "True", "0", "f", "F", "FALSE", "false", "False", "yes", "", "tRUE"} {
		b, err := strconv.ParseBool(s)
		fmt.Println(b, err)
	}
	fmt.Println(strconv.FormatBool(true), strconv.FormatBool(false))

	for base := 2; base <= 36; base += 7 {
		fmt.Println(base, strconv.FormatInt(255, base), strconv.FormatInt(-255, base), strconv.FormatUint(1<<63, base))
	}
	fmt.Println(strconv.FormatInt(math.MaxInt64, 10), strconv.FormatInt(math.MinInt64, 10), strconv.FormatInt(math.MinInt64, 2), strconv.FormatInt(math.MinInt64, 16))
	fmt.Println(strconv.FormatUint(math.MaxUint64, 10), strconv.FormatUint(math.MaxUint64, 16), strconv.FormatUint(math.MaxUint64, 36), strconv.FormatUint(0, 7))
	fmt.Println(strconv.FormatInt(99, 10), strconv.FormatInt(100, 10), strconv.FormatInt(-1, 10), strconv.FormatInt(1234567890123, 10))

	b := []byte("n=")
	b = strconv.AppendInt(b, -42, 10)
	b = strconv.AppendBool(b, true)
	b = strconv.AppendUint(b, 255, 16)
	b = strconv.AppendInt(b, math.MinInt64, 10)
	fmt.Println(string(b))
	fmt.Println(string(strconv.AppendInt(nil, 7, 2)), string(strconv.AppendBool(nil, false)))

	big, err := strconv.ParseInt("9223372036854775807", 10, 64)
	fmt.Println(big+0 == math.MaxInt64, err)
	var i64 int64 = big
	fmt.Printf("%T %d\\n", i64, i64)
}
`,
		`0 -45 1099511627776 64
123 <nil>
-45 <nil>
7 <nil>
0 strconv.Atoi: parsing "": invalid syntax
0 strconv.Atoi: parsing "abc": invalid syntax
0 strconv.Atoi: parsing "12a": invalid syntax
0 strconv.Atoi: parsing "1_000": invalid syntax
0 strconv.Atoi: parsing " 1": invalid syntax
ff 16 64 -> 255 <nil>
-ff 16 64 -> -255 <nil>
0xff 0 64 -> 255 <nil>
0b101 0 8 -> 5 <nil>
0o17 0 64 -> 15 <nil>
017 0 64 -> 15 <nil>
1_000 0 64 -> 1000 <nil>
1__0 0 64 -> 0 strconv.ParseInt: parsing "1__0": invalid syntax
_1 0 64 -> 0 strconv.ParseInt: parsing "_1": invalid syntax
zz 36 64 -> 1295 <nil>
ZZ 36 64 -> 1295 <nil>
12 2 64 -> 0 strconv.ParseInt: parsing "12": invalid syntax
128 10 8 -> 127 strconv.ParseInt: parsing "128": value out of range
-129 10 8 -> -128 strconv.ParseInt: parsing "-129": value out of range
127 10 8 -> 127 <nil>
-128 10 8 -> -128 <nil>
32768 10 16 -> 32767 strconv.ParseInt: parsing "32768": value out of range
2147483648 10 32 -> 2147483647 strconv.ParseInt: parsing "2147483648": value out of range
9223372036854775807 10 64 -> 9223372036854775807 <nil>
9223372036854775808 10 64 -> 9223372036854775807 strconv.ParseInt: parsing "9223372036854775808": value out of range
-9223372036854775808 10 64 -> -9223372036854775808 <nil>
-9223372036854775809 10 64 -> -9223372036854775808 strconv.ParseInt: parsing "-9223372036854775809": value out of range
1 1 64 -> 0 strconv.ParseInt: parsing "1": invalid base 1
1 37 64 -> 0 strconv.ParseInt: parsing "1": invalid base 37
1 10 65 -> 0 strconv.ParseInt: parsing "1": invalid bit size 65
1 10 -1 -> 0 strconv.ParseInt: parsing "1": invalid bit size -1
 10 64 -> 0 strconv.ParseInt: parsing "": invalid syntax
- 10 64 -> 0 strconv.ParseInt: parsing "-": invalid syntax
18446744073709551615 10 64 -> 18446744073709551615 <nil>
18446744073709551616 10 64 -> 18446744073709551615 strconv.ParseUint: parsing "18446744073709551616": value out of range
-1 10 64 -> 0 strconv.ParseUint: parsing "-1": invalid syntax
+1 10 64 -> 0 strconv.ParseUint: parsing "+1": invalid syntax
255 10 8 -> 255 <nil>
256 10 8 -> 255 strconv.ParseUint: parsing "256": value out of range
ffffffffffffffff 16 64 -> 18446744073709551615 <nil>
10000000000000000 16 64 -> 18446744073709551615 strconv.ParseUint: parsing "10000000000000000": value out of range
0x1f 0 64 -> 31 <nil>
true false true
ParseInt 300 true true
true strconv.Atoi: parsing "x": invalid syntax
value out of range invalid syntax
true <nil>
true <nil>
true <nil>
true <nil>
true <nil>
true <nil>
false <nil>
false <nil>
false <nil>
false <nil>
false <nil>
false <nil>
false strconv.ParseBool: parsing "yes": invalid syntax
false strconv.ParseBool: parsing "": invalid syntax
false strconv.ParseBool: parsing "tRUE": invalid syntax
true false
2 11111111 -11111111 1000000000000000000000000000000000000000000000000000000000000000
9 313 -313 67404283172107811828
16 ff -ff 8000000000000000
23 b2 -b2 i6k448cf4192c3
30 8f -8f hajppbc1fc208
9223372036854775807 -9223372036854775808 -1000000000000000000000000000000000000000000000000000000000000000 -8000000000000000
18446744073709551615 ffffffffffffffff 3w5e11264sgsf 0
99 100 -1 1234567890123
n=-42trueff-9223372036854775808
111 false
true <nil>
int64 9223372036854775807
`,
	);
});

test("quoting, unquoting and rune classes", async () => {
	await assertFourWay(
		`package main

import (
	"fmt"
	"strconv"
)

func main() {
	for _, s := range []string{"hello", "say \\"hi\\"", "tab\\there\\n", "back\\\\slash", "nul\\x00", "\\x7f", "é世界", "\\U0001F600", " ", "\\a\\b\\f\\r\\v", "it's", ""} {
		fmt.Println(strconv.Quote(s), strconv.QuoteToASCII(s))
	}
	for _, r := range []rune{'a', '\\'', '"', '\\n', 0, 0x7f, 0xe9, 0x4e16, 0x1F600, 0xFFFD, -1, 0x110000, 0xD800} {
		fmt.Println(strconv.QuoteRune(r), strconv.QuoteRuneToASCII(r))
	}
	fmt.Println(string(strconv.AppendQuote([]byte("q:"), "a\\tb")), string(strconv.AppendQuoteToASCII(nil, "é")))
	fmt.Println(string(strconv.AppendQuoteRune([]byte("r:"), 'x')), string(strconv.AppendQuoteRuneToASCII(nil, 'é')))

	for _, s := range []string{\`"hello"\`, \`"a\\tb"\`, \`"é\\U0001F600"\`, \`"\\x41\\101"\`, "\`raw\\\\n\`", \`'x'\`, \`'\\n'\`, \`""\`, "\`\`", \`"unterminated\`, \`hello\`, \`"a"b"\`, \`"\\q"\`, \`'ab'\`, \`''\`, \`"\\xZZ"\`, \`"\\400"\`, \`"\\ud800"\`, "\\"line\\nbreak\\"", \`"a" \`, "\`a\`b", \`'"'\`, \`"'"\`, \`'\\''\`, \`"\\'"\`, \`'\\"'\`} {
		v, err := strconv.Unquote(s)
		fmt.Printf("%q %q %v\\n", s, v, err)
	}
	for _, s := range []string{\`"abc"def\`, "\`raw\`rest", \`'x'y\`, \`"a\\"b"c\`, \`abc\`, \`"unterminated\`, \`"\\q"x\`} {
		v, err := strconv.QuotedPrefix(s)
		fmt.Printf("%q %q %v\\n", s, v, err)
	}
	for _, s := range []string{\`\\nrest\`, \`abc\`, \`éz\`, \`\\x41\`, \`\\101\`, \`\\"\`, \`\\'\`, \`\\q\`, \`é\`, \`\\U0001F600!\`, \`\`} {
		for _, q := range []byte{'"', '\\''} {
			v, mb, tail, err := strconv.UnquoteChar(s, q)
			fmt.Printf("%q %c %q %v %v %q %v\\n", s, q, v, v, mb, tail, err)
		}
	}
	for _, s := range []string{"abc", "a\`b", "a\\nb", "tab\\t", "\\x7f", "\\ufeff", "é", ""} {
		fmt.Println(strconv.CanBackquote(s))
	}
	for _, r := range []rune{'a', ' ', '\\t', 0x7f, 0xa0, 0xad, 0xe9, 0x4e16, 0x1F600, 0x2028, 0xe000, 0x10ffff, -1} {
		fmt.Println(strconv.IsPrint(r), strconv.IsGraphic(r))
	}
	for _, s := range []string{"héllo 世界 \\U0001F600 \\x00 ​"} {
		q := strconv.Quote(s)
		u, err := strconv.Unquote(q)
		fmt.Println(q, u == s, err)
	}
}
`,
		`"hello" "hello"
"say \\"hi\\"" "say \\"hi\\""
"tab\\there\\n" "tab\\there\\n"
"back\\\\slash" "back\\\\slash"
"nul\\x00" "nul\\x00"
"\\x7f" "\\x7f"
"é世界" "\\u00e9\\u4e16\\u754c"
"😀" "\\U0001f600"
"\\u2028" "\\u2028"
"\\a\\b\\f\\r\\v" "\\a\\b\\f\\r\\v"
"it's" "it's"
"" ""
'a' 'a'
'\\'' '\\''
'"' '"'
'\\n' '\\n'
'\\x00' '\\x00'
'\\x7f' '\\x7f'
'é' '\\u00e9'
'世' '\\u4e16'
'😀' '\\U0001f600'
'�' '\\ufffd'
'�' '\\ufffd'
'�' '\\ufffd'
'�' '\\ufffd'
q:"a\\tb" "\\u00e9"
r:'x' '\\u00e9'
"\\"hello\\"" "hello" <nil>
"\\"a\\\\tb\\"" "a\\tb" <nil>
"\\"é\\\\U0001F600\\"" "é😀" <nil>
"\\"\\\\x41\\\\101\\"" "AA" <nil>
"\`raw\\\\n\`" "raw\\\\n" <nil>
"'x'" "x" <nil>
"'\\\\n'" "\\n" <nil>
"\\"\\"" "" <nil>
"\`\`" "" <nil>
"\\"unterminated" "" invalid syntax
"hello" "" invalid syntax
"\\"a\\"b\\"" "" invalid syntax
"\\"\\\\q\\"" "" invalid syntax
"'ab'" "" invalid syntax
"''" "" <nil>
"\\"\\\\xZZ\\"" "" invalid syntax
"\\"\\\\400\\"" "" invalid syntax
"\\"\\\\ud800\\"" "" invalid syntax
"\\"line\\nbreak\\"" "" invalid syntax
"\\"a\\" " "" invalid syntax
"\`a\`b" "" invalid syntax
"'\\"'" "\\"" <nil>
"\\"'\\"" "'" <nil>
"'\\\\''" "'" <nil>
"\\"\\\\'\\"" "" invalid syntax
"'\\\\\\"'" "" invalid syntax
"\\"abc\\"def" "\\"abc\\"" <nil>
"\`raw\`rest" "\`raw\`" <nil>
"'x'y" "'x'" <nil>
"\\"a\\\\\\"b\\"c" "\\"a\\\\\\"b\\"" <nil>
"abc" "" invalid syntax
"\\"unterminated" "" invalid syntax
"\\"\\\\q\\"x" "" invalid syntax
"\\\\nrest" " '\\n' 10 false "rest" <nil>
"\\\\nrest" ' '\\n' 10 false "rest" <nil>
"abc" " 'a' 97 false "bc" <nil>
"abc" ' 'a' 97 false "bc" <nil>
"éz" " 'é' 233 true "z" <nil>
"éz" ' 'é' 233 true "z" <nil>
"\\\\x41" " 'A' 65 false "" <nil>
"\\\\x41" ' 'A' 65 false "" <nil>
"\\\\101" " 'A' 65 false "" <nil>
"\\\\101" ' 'A' 65 false "" <nil>
"\\\\\\"" " '"' 34 false "" <nil>
"\\\\\\"" ' '\\x00' 0 false "" invalid syntax
"\\\\'" " '\\x00' 0 false "" invalid syntax
"\\\\'" ' '\\'' 39 false "" <nil>
"\\\\q" " '\\x00' 0 false "" invalid syntax
"\\\\q" ' '\\x00' 0 false "" invalid syntax
"é" " 'é' 233 true "" <nil>
"é" ' 'é' 233 true "" <nil>
"\\\\U0001F600!" " '😀' 128512 true "!" <nil>
"\\\\U0001F600!" ' '😀' 128512 true "!" <nil>
"" " '\\x00' 0 false "" invalid syntax
"" ' '\\x00' 0 false "" invalid syntax
true
false
false
true
false
false
true
true
true true
true true
false false
false false
false true
false false
true true
true true
true true
false false
false false
false false
false false
"héllo 世界 😀 \\x00 \\u200b" true <nil>
`,
	);
});

test("floats: formatting, parsing, bit sizes and round trips", async () => {
	await assertFourWay(
		`package main

import (
	"fmt"
	"math"
	"strconv"
)

func main() {
	p, q := 0.2, 0.1
	vals := []float64{0, 1, -1, 0.5, 1.5, 100, 1e21, 1e20, 123456789, 1.0 / 3, 2.5e-7, 1e-6, 0.000123, 5e-324, math.MaxFloat64, math.SmallestNonzeroFloat64, 0.1, p+q, 123456.789e3, 1e23, 9007199254740992, 4.35, 2.675}
	for _, v := range vals {
		fmt.Println(v, strconv.FormatFloat(v, 'g', -1, 64), strconv.FormatFloat(v, 'e', -1, 64), strconv.FormatFloat(v, 'f', -1, 64), strconv.FormatFloat(v, 'E', -1, 64), strconv.FormatFloat(v, 'G', -1, 64))
	}
	for _, v := range []float64{1.5, 2.675, 1234.5678, 0.000123456, 1e21, 99.995, 0.5, 1.005} {
		for _, p := range []int{0, 1, 2, 5, 10} {
			fmt.Println(v, p, strconv.FormatFloat(v, 'f', p, 64), strconv.FormatFloat(v, 'e', p, 64), strconv.FormatFloat(v, 'g', p, 64))
		}
	}
	fmt.Println(strconv.FormatFloat(math.Copysign(0, -1), 'f', -1, 64), strconv.FormatFloat(math.Copysign(0, -1), 'g', -1, 64), strconv.FormatFloat(math.Copysign(0, -1), 'e', 3, 64))
	fmt.Println(strconv.FormatFloat(math.Inf(1), 'f', -1, 64), strconv.FormatFloat(math.Inf(-1), 'g', 3, 64), strconv.FormatFloat(math.NaN(), 'e', 2, 64))
	fmt.Println(strconv.FormatFloat(1.5, 'b', -1, 64), strconv.FormatFloat(1, 'x', -1, 64), strconv.FormatFloat(0.1, 'X', 3, 64), strconv.FormatFloat(255.5, 'x', -1, 64), strconv.FormatFloat(0, 'x', -1, 64))
	fmt.Println(strconv.FormatFloat(3.14159265358979, 'g', -1, 32), strconv.FormatFloat(0.1, 'g', -1, 32), strconv.FormatFloat(float64(float32(0.1)), 'g', -1, 32), strconv.FormatFloat(float64(float32(16777216)), 'f', -1, 32), strconv.FormatFloat(1e10, 'e', -1, 32), strconv.FormatFloat(float64(float32(1.17549435e-38)), 'g', -1, 32))
	fmt.Println(strconv.FormatFloat(1, 'z', -1, 64))
	fmt.Println(string(strconv.AppendFloat([]byte("f="), 2.5, 'f', 2, 64)), string(strconv.AppendFloat(nil, 1e100, 'g', -1, 64)))

	for _, s := range []string{"3.14159", "-0", "+1.5", ".5", "5.", "1e3", "1E-3", "1e+3", "0x1p-2", "0X1.8P1", "0x.8p1", "Inf", "-inf", "+Infinity", "NaN", "nan", "infinit", "1_000.5", "0x_1p0", "0x1_0p0", "", "abc", "1.2.3", "1e", "e1", "--1", "1e400", "-1e400", "1e-400", "4.9e-324", "2.4e-324", "1.7976931348623157e308", "1.7976931348623159e308", "123456789012345678901234567890", "0.000000000000000000000000000001", "9007199254740993", "1.00000000000000011102230246251565404236316680908203125", "1.00000000000000011102230246251565404236316680908203126", " 1", "1 ", "0x", "0x1", "0x1p", "1e5000000000", "é"} {
		f, err := strconv.ParseFloat(s, 64)
		fmt.Println(s, f, math.Signbit(f), err)
	}
	for _, s := range []string{"3.14159", "1e39", "-1e39", "3.4028234663852886e38", "3.4028235e38", "3.4028236e38", "1e-46", "1.4e-45", "0.1", "16777217", "0x1p-149", "1e38", "abc"} {
		f, err := strconv.ParseFloat(s, 32)
		fmt.Println(s, f, float32(f), err)
	}
	fmt.Println(strconv.ParseFloat(" ", 64))
	for _, v := range []float64{0.1, 1.0 / 3, 123456.789, 1e-7, 1e22, 5e-324, 1.7976931348623157e308, 2.2250738585072014e-308, 4.35, 0.3} {
		s := strconv.FormatFloat(v, 'g', -1, 64)
		back, _ := strconv.ParseFloat(s, 64)
		s32 := strconv.FormatFloat(v, 'g', -1, 32)
		back32, _ := strconv.ParseFloat(s32, 32)
		fmt.Println(s, back == v, s32, back32 == float64(float32(v)))
	}
	f, err := strconv.ParseFloat("2.5", 64)
	fmt.Println(f, err)
	fmt.Println(strconv.ParseFloat("1e400", 64))
	fmt.Println(strconv.ParseFloat("1e39", 32))
	fmt.Println(strconv.ParseFloat("x1", 64))
}
`,
		`0 0 0e+00 0 0E+00 0
1 1 1e+00 1 1E+00 1
-1 -1 -1e+00 -1 -1E+00 -1
0.5 0.5 5e-01 0.5 5E-01 0.5
1.5 1.5 1.5e+00 1.5 1.5E+00 1.5
100 100 1e+02 100 1E+02 100
1e+21 1e+21 1e+21 1000000000000000000000 1E+21 1E+21
1e+20 1e+20 1e+20 100000000000000000000 1E+20 1E+20
1.23456789e+08 1.23456789e+08 1.23456789e+08 123456789 1.23456789E+08 1.23456789E+08
0.3333333333333333 0.3333333333333333 3.333333333333333e-01 0.3333333333333333 3.333333333333333E-01 0.3333333333333333
2.5e-07 2.5e-07 2.5e-07 0.00000025 2.5E-07 2.5E-07
1e-06 1e-06 1e-06 0.000001 1E-06 1E-06
0.000123 0.000123 1.23e-04 0.000123 1.23E-04 0.000123
5e-324 5e-324 5e-324 0.000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000005 5E-324 5E-324
1.7976931348623157e+308 1.7976931348623157e+308 1.7976931348623157e+308 179769313486231570000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000 1.7976931348623157E+308 1.7976931348623157E+308
5e-324 5e-324 5e-324 0.000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000005 5E-324 5E-324
0.1 0.1 1e-01 0.1 1E-01 0.1
0.30000000000000004 0.30000000000000004 3.0000000000000004e-01 0.30000000000000004 3.0000000000000004E-01 0.30000000000000004
1.23456789e+08 1.23456789e+08 1.23456789e+08 123456789 1.23456789E+08 1.23456789E+08
1e+23 1e+23 1e+23 100000000000000000000000 1E+23 1E+23
9.007199254740992e+15 9.007199254740992e+15 9.007199254740992e+15 9007199254740992 9.007199254740992E+15 9.007199254740992E+15
4.35 4.35 4.35e+00 4.35 4.35E+00 4.35
2.675 2.675 2.675e+00 2.675 2.675E+00 2.675
1.5 0 2 2e+00 2
1.5 1 1.5 1.5e+00 2
1.5 2 1.50 1.50e+00 1.5
1.5 5 1.50000 1.50000e+00 1.5
1.5 10 1.5000000000 1.5000000000e+00 1.5
2.675 0 3 3e+00 3
2.675 1 2.7 2.7e+00 3
2.675 2 2.67 2.67e+00 2.7
2.675 5 2.67500 2.67500e+00 2.675
2.675 10 2.6750000000 2.6750000000e+00 2.675
1234.5678 0 1235 1e+03 1e+03
1234.5678 1 1234.6 1.2e+03 1e+03
1234.5678 2 1234.57 1.23e+03 1.2e+03
1234.5678 5 1234.56780 1.23457e+03 1234.6
1234.5678 10 1234.5678000000 1.2345678000e+03 1234.5678
0.000123456 0 0 1e-04 0.0001
0.000123456 1 0.0 1.2e-04 0.0001
0.000123456 2 0.00 1.23e-04 0.00012
0.000123456 5 0.00012 1.23456e-04 0.00012346
0.000123456 10 0.0001234560 1.2345600000e-04 0.000123456
1e+21 0 1000000000000000000000 1e+21 1e+21
1e+21 1 1000000000000000000000.0 1.0e+21 1e+21
1e+21 2 1000000000000000000000.00 1.00e+21 1e+21
1e+21 5 1000000000000000000000.00000 1.00000e+21 1e+21
1e+21 10 1000000000000000000000.0000000000 1.0000000000e+21 1e+21
99.995 0 100 1e+02 1e+02
99.995 1 100.0 1.0e+02 1e+02
99.995 2 100.00 1.00e+02 1e+02
99.995 5 99.99500 9.99950e+01 99.995
99.995 10 99.9950000000 9.9995000000e+01 99.995
0.5 0 0 5e-01 0.5
0.5 1 0.5 5.0e-01 0.5
0.5 2 0.50 5.00e-01 0.5
0.5 5 0.50000 5.00000e-01 0.5
0.5 10 0.5000000000 5.0000000000e-01 0.5
1.005 0 1 1e+00 1
1.005 1 1.0 1.0e+00 1
1.005 2 1.00 1.00e+00 1
1.005 5 1.00500 1.00500e+00 1.005
1.005 10 1.0050000000 1.0050000000e+00 1.005
-0 -0 -0.000e+00
+Inf -Inf NaN
6755399441055744p-52 0x1p+00 0X1.99AP-04 0x1.ffp+07 0x0p+00
3.1415927 0.1 0.1 16777216 1e+10 1.1754944e-38
%z
f=2.50 1e+100
3.14159 3.14159 false <nil>
-0 -0 true <nil>
+1.5 1.5 false <nil>
.5 0.5 false <nil>
5. 5 false <nil>
1e3 1000 false <nil>
1E-3 0.001 false <nil>
1e+3 1000 false <nil>
0x1p-2 0.25 false <nil>
0X1.8P1 3 false <nil>
0x.8p1 1 false <nil>
Inf +Inf false <nil>
-inf -Inf true <nil>
+Infinity +Inf false <nil>
NaN NaN false <nil>
nan NaN false <nil>
infinit 0 false strconv.ParseFloat: parsing "infinit": invalid syntax
1_000.5 1000.5 false <nil>
0x_1p0 1 false <nil>
0x1_0p0 16 false <nil>
 0 false strconv.ParseFloat: parsing "": invalid syntax
abc 0 false strconv.ParseFloat: parsing "abc": invalid syntax
1.2.3 0 false strconv.ParseFloat: parsing "1.2.3": invalid syntax
1e 0 false strconv.ParseFloat: parsing "1e": invalid syntax
e1 0 false strconv.ParseFloat: parsing "e1": invalid syntax
--1 0 false strconv.ParseFloat: parsing "--1": invalid syntax
1e400 +Inf false strconv.ParseFloat: parsing "1e400": value out of range
-1e400 -Inf true strconv.ParseFloat: parsing "-1e400": value out of range
1e-400 0 false <nil>
4.9e-324 5e-324 false <nil>
2.4e-324 0 false <nil>
1.7976931348623157e308 1.7976931348623157e+308 false <nil>
1.7976931348623159e308 +Inf false strconv.ParseFloat: parsing "1.7976931348623159e308": value out of range
123456789012345678901234567890 1.2345678901234568e+29 false <nil>
0.000000000000000000000000000001 1e-30 false <nil>
9007199254740993 9.007199254740992e+15 false <nil>
1.00000000000000011102230246251565404236316680908203125 1 false <nil>
1.00000000000000011102230246251565404236316680908203126 1.0000000000000002 false <nil>
 1 0 false strconv.ParseFloat: parsing " 1": invalid syntax
1  0 false strconv.ParseFloat: parsing "1 ": invalid syntax
0x 0 false strconv.ParseFloat: parsing "0x": invalid syntax
0x1 0 false strconv.ParseFloat: parsing "0x1": invalid syntax
0x1p 0 false strconv.ParseFloat: parsing "0x1p": invalid syntax
1e5000000000 +Inf false strconv.ParseFloat: parsing "1e5000000000": value out of range
é 0 false strconv.ParseFloat: parsing "é": invalid syntax
3.14159 3.141590118408203 3.14159 <nil>
1e39 +Inf +Inf strconv.ParseFloat: parsing "1e39": value out of range
-1e39 -Inf -Inf strconv.ParseFloat: parsing "-1e39": value out of range
3.4028234663852886e38 3.4028234663852886e+38 3.4028235e+38 <nil>
3.4028235e38 3.4028234663852886e+38 3.4028235e+38 <nil>
3.4028236e38 +Inf +Inf strconv.ParseFloat: parsing "3.4028236e38": value out of range
1e-46 0 0 <nil>
1.4e-45 1.401298464324817e-45 1e-45 <nil>
0.1 0.10000000149011612 0.1 <nil>
16777217 1.6777216e+07 1.6777216e+07 <nil>
0x1p-149 1.401298464324817e-45 1e-45 <nil>
1e38 9.999999680285692e+37 1e+38 <nil>
abc 0 0 strconv.ParseFloat: parsing "abc": invalid syntax
0 strconv.ParseFloat: parsing " ": invalid syntax
0.1 true 0.1 true
0.3333333333333333 true 0.33333334 true
123456.789 true 123456.79 true
1e-07 true 1e-07 true
1e+22 true 1e+22 true
5e-324 true 0 true
1.7976931348623157e+308 true +Inf true
2.2250738585072014e-308 true 0 true
4.35 true 4.35 true
0.3 true 0.3 true
2.5 <nil>
+Inf strconv.ParseFloat: parsing "1e400": value out of range
+Inf strconv.ParseFloat: parsing "1e39": value out of range
0 strconv.ParseFloat: parsing "x1": invalid syntax
`,
	);
});

test("Unquote keeps UTF-8 text in raw strings containing a carriage return", async () => {
	await assertFourWay(
		`package main

import (
	"fmt"
	"strconv"
)

func main() {
	s, err := strconv.Unquote("\`\ré\`")
	fmt.Printf("%q %v\\n", s, err)
	s, err = strconv.Unquote("\`a\r世\r界\`")
	fmt.Printf("%q %v\\n", s, err)
}
`,
		`"é" <nil>
"a世界" <nil>
`,
	);
});

test("FormatFloat 'f' with a precision rounds exact ties to even like Go", async () => {
	await assertFourWay(
		`package main

import (
	"fmt"
	"strconv"
)

func main() {
	for _, x := range []float64{0.5, 1.5, 2.5, 0.125, 0.375, 0.15, 2.675, 1e20, 1e21, 123456.789, -0.5, 0, 3.14159, 5e-324, 1.0 / 3} {
		fmt.Println(strconv.FormatFloat(x, 'f', 0, 64), strconv.FormatFloat(x, 'f', 2, 64), strconv.FormatFloat(x, 'f', 3, 64), fmt.Sprintf("%8.1f|%-8.2f|%+.1f|%08.3f", x, x, x, x))
	}
}
`,
		`0 0.50 0.500      0.5|0.50    |+0.5|0000.500
2 1.50 1.500      1.5|1.50    |+1.5|0001.500
2 2.50 2.500      2.5|2.50    |+2.5|0002.500
0 0.12 0.125      0.1|0.12    |+0.1|0000.125
0 0.38 0.375      0.4|0.38    |+0.4|0000.375
0 0.15 0.150      0.1|0.15    |+0.1|0000.150
3 2.67 2.675      2.7|2.67    |+2.7|0002.675
100000000000000000000 100000000000000000000.00 100000000000000000000.000 100000000000000000000.0|100000000000000000000.00|+100000000000000000000.0|100000000000000000000.000
1000000000000000000000 1000000000000000000000.00 1000000000000000000000.000 1000000000000000000000.0|1000000000000000000000.00|+1000000000000000000000.0|1000000000000000000000.000
123457 123456.79 123456.789 123456.8|123456.79|+123456.8|123456.789
-0 -0.50 -0.500     -0.5|-0.50   |-0.5|-000.500
0 0.00 0.000      0.0|0.00    |+0.0|0000.000
3 3.14 3.142      3.1|3.14    |+3.1|0003.142
0 0.00 0.000      0.0|0.00    |+0.0|0000.000
0 0.33 0.333      0.3|0.33    |+0.3|0000.333
`,
	);
});
