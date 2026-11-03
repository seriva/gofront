// GoFront test suite — encoding/hex (Go-source)
//
// Every case runs four ways (JS and WASM, natives on and off) and must print
// what the real Go toolchain printed for the same program.

import { assertFourWay, section, test } from "../helpers.js";

section("encoding/hex (Go-source)");

test("encode, decode, append forms and Go's error messages", async () => {
	await assertFourWay(
		`package main

import (
	"errors"
	"fmt"

	"encoding/hex"
)

func main() {
	src := []byte("Hello Gopher!")
	s := hex.EncodeToString(src)
	fmt.Println(s, hex.EncodedLen(len(src)), hex.DecodedLen(len(s)))
	b, err := hex.DecodeString(s)
	fmt.Println(string(b), err)

	dst := make([]byte, hex.EncodedLen(3))
	fmt.Println(hex.Encode(dst, []byte{1, 0xab, 0xff}), string(dst))
	out := make([]byte, 3)
	n, err := hex.Decode(out, []byte("01ABff"))
	fmt.Println(n, out, err)

	b, err = hex.DecodeString("")
	fmt.Println(len(b), err)
	b, err = hex.DecodeString("4g")
	fmt.Println(b, err)
	b, err = hex.DecodeString("486")
	fmt.Println(b, err)
	b, err = hex.DecodeString("abc")
	fmt.Println(b, err, errors.Is(err, hex.ErrLength))
	_, err = hex.DecodeString("0x")
	fmt.Println(err)
	_, err = hex.DecodeString("0\\x01")
	fmt.Println(err)
	_, err = hex.DecodeString("zq")
	fmt.Println(err)
	_, err = hex.DecodeString("é")
	fmt.Println(err)
	fmt.Println(hex.InvalidByteError('g').Error())

	fmt.Println(string(hex.AppendEncode([]byte("x="), []byte{0xde, 0xad})))
	app, err := hex.AppendDecode([]byte("x"), []byte("dead"))
	fmt.Println(app, err)
	app, err = hex.AppendDecode(nil, []byte("de!d"))
	fmt.Println(app, err)
	fmt.Println(hex.ErrLength == hex.ErrLength, hex.ErrLength)
}
`,
		`48656c6c6f20476f7068657221 26 13
Hello Gopher! <nil>
6 01abff
3 [1 171 255] <nil>
0 <nil>
[] encoding/hex: invalid byte: U+0067 'g'
[72] encoding/hex: odd length hex string
[171] encoding/hex: odd length hex string true
encoding/hex: invalid byte: U+0078 'x'
encoding/hex: invalid byte: U+0001
encoding/hex: invalid byte: U+007A 'z'
encoding/hex: invalid byte: U+00C3 'Ã'
encoding/hex: invalid byte: U+0067 'g'
x=dead
[120 222 173] <nil>
[222] encoding/hex: invalid byte: U+0021 '!'
true encoding/hex: odd length hex string
`,
	);
});
