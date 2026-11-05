// GoFront test suite — unicode (Go-source)
//
// Every case runs four ways (JS and WASM, natives on and off) and must print
// what the real Go toolchain printed for the same program.

import {
	assertErrorContains,
	assertFourWay,
	compile,
	section,
	test,
} from "../helpers.js";

section("unicode (Go-source)");

test("every predicate and mapping on ASCII, non-ASCII and invalid runes", async () => {
	await assertFourWay(
		`package main

import (
	"fmt"
	"unicode"
)

func main() {
	runes := []rune{'a', 'Z', '5', ' ', '\\n', '!', '$', 0x7f, 'é', 'É', 'ñ', 'Ω', 'ω', 0x663, 0x3002, 0x85, 'ß', 0x130, 0x131, 0x17f, '日', 0x1F600, -1, 0x110000}
	for _, r := range runes {
		fmt.Println(r, unicode.IsLetter(r), unicode.IsDigit(r), unicode.IsSpace(r), unicode.IsUpper(r), unicode.IsLower(r), unicode.IsPunct(r), unicode.IsControl(r), unicode.IsPrint(r), unicode.IsGraphic(r), unicode.ToUpper(r), unicode.ToLower(r))
	}
	var count int
	for r := rune(0); r < 128; r++ {
		if unicode.IsPunct(r) {
			count++
		}
	}
	fmt.Println(count)
}
`,
		`97 true false false false true false false true true 65 97
90 true false false true false false false true true 90 122
53 false true false false false false false true true 53 53
32 false false true false false false false true true 32 32
10 false false true false false false true false false 10 10
33 false false false false false true false true true 33 33
36 false false false false false false false true true 36 36
127 false false false false false false true false false 127 127
233 true false false false true false false true true 201 233
201 true false false true false false false true true 201 233
241 true false false false true false false true true 209 241
937 true false false true false false false true true 937 969
969 true false false false true false false true true 937 969
1635 false true false false false false false true true 1635 1635
12290 false false false false false true false true true 12290 12290
133 false false true false false false true false false 133 133
223 true false false false true false false true true 223 223
304 true false false true false false false true true 304 105
305 true false false false true false false true true 73 305
383 true false false false true false false true true 83 383
26085 true false false false false false false true true 26085 26085
128512 false false false false false false false true true 128512 128512
-1 false false false false false false false false false -1 -1
1114112 false false false false false false false false false 1114112 1114112
23
`,
	);
});

test("the predicates take runes and compose with strings.Map", async () => {
	await assertFourWay(
		`package main

import (
	"fmt"
	"strings"
	"unicode"
)

func main() {
	fmt.Println(strings.Map(unicode.ToUpper, "héllo wörld"))
	fmt.Println(strings.Map(unicode.ToLower, "HÉLLO WÖRLD"))
	fmt.Println(strings.FieldsFunc("a1b2é3c", unicode.IsDigit))
	fmt.Println(strings.IndexFunc("12é", unicode.IsLetter))
	f := unicode.IsSpace
	fmt.Println(f('\\t'), f('x'))
}
`,
		`HÉLLO WÖRLD
héllo wörld
[a b é c]
2
true false
`,
	);
});

test("unicode.IsNumber is still not available", () => {
	const { errors } = compile(`package main
import "unicode"
func main() { _ = unicode.IsNumber('1') }`);
	assertErrorContains(errors, "unicode.IsNumber");
});
