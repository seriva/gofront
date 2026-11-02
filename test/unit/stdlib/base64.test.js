// GoFront test suite — encoding/base64 (Go-source)
//
// Every case runs four ways (JS and WASM, natives on and off) and must print
// what the real Go toolchain printed for the same program.

import { assertFourWay, section, test } from "../helpers.js";

section("encoding/base64 (Go-source)");

test("alphabets, padding, decoding errors and panics match Go", async () => {
	await assertFourWay(
		`package main

import (
	"fmt"

	"encoding/base64"
)

func show(label string, b []byte, err error) {
	fmt.Printf("%s: %q %v\\n", label, string(b), err)
}

func main() {
	src := []byte("hello world!!")
	fmt.Println(base64.StdEncoding.EncodeToString(src))
	fmt.Println(base64.URLEncoding.EncodeToString([]byte{0xfb, 0xff, 0xfe, 0x01}))
	fmt.Println(base64.StdEncoding.EncodeToString([]byte{0xfb, 0xff, 0xfe, 0x01}))
	fmt.Println(base64.RawStdEncoding.EncodeToString([]byte("hi")), base64.RawURLEncoding.EncodeToString([]byte{0xfb, 0xff}))
	fmt.Println(base64.StdEncoding.EncodeToString(nil) == "", base64.StdEncoding.EncodeToString([]byte("f")), base64.StdEncoding.EncodeToString([]byte("fo")), base64.StdEncoding.EncodeToString([]byte("foo")))
	fmt.Println(base64.StdEncoding.EncodedLen(10), base64.RawStdEncoding.EncodedLen(10), base64.StdEncoding.DecodedLen(16), base64.RawStdEncoding.DecodedLen(14))
	fmt.Println(base64.StdPadding, base64.NoPadding)

	b, err := base64.StdEncoding.DecodeString("aGVsbG8gd29ybGQhIQ==")
	show("std", b, err)
	b, err = base64.URLEncoding.DecodeString("-__-AQ==")
	fmt.Println(b, err)
	b, err = base64.RawStdEncoding.DecodeString("aGk")
	show("raw", b, err)
	b, err = base64.StdEncoding.DecodeString("aGVs\\nbG8=")
	show("newline", b, err)
	b, err = base64.StdEncoding.DecodeString("")
	show("empty", b, err)

	b, err = base64.StdEncoding.DecodeString("!!!")
	show("bang", b, err)
	b, err = base64.StdEncoding.DecodeString("aGVsbG8")
	show("unpadded", b, err)
	b, err = base64.RawStdEncoding.DecodeString("aGVsbG8=")
	show("raw padded", b, err)
	b, err = base64.StdEncoding.DecodeString("aGVsbG8=x")
	show("trailing", b, err)
	b, err = base64.StdEncoding.DecodeString("aGVsbG8*")
	show("bad pad", b, err)
	b, err = base64.StdEncoding.DecodeString("aGVsb===")
	show("extra pad", b, err)
	b, err = base64.StdEncoding.DecodeString("a")
	show("one char", b, err)
	b, err = base64.StdEncoding.DecodeString("aG=")
	show("short pad", b, err)

	custom := base64.NewEncoding("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_").WithPadding('*')
	enc := custom.EncodeToString([]byte("hi"))
	fmt.Println(enc)
	b, err = custom.DecodeString(enc)
	show("custom", b, err)
	b, err = base64.StdEncoding.DecodeString(enc)
	show("custom as std", b, err)

	dst := make([]byte, base64.StdEncoding.EncodedLen(3))
	base64.StdEncoding.Encode(dst, []byte("abc"))
	fmt.Println(string(dst))
	out := make([]byte, 3)
	n, err := base64.StdEncoding.Decode(out, dst)
	fmt.Println(n, out, err)
	fmt.Println(string(base64.StdEncoding.AppendEncode([]byte("x="), []byte("hi"))))
	app, err := base64.StdEncoding.AppendDecode([]byte("x="), []byte("aGk="))
	show("append", app, err)

	for _, alphabet := range []string{"abc", "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+\\n", "AACDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"} {
		func() {
			defer func() { fmt.Println(recover()) }()
			base64.NewEncoding(alphabet)
		}()
	}
	func() {
		defer func() { fmt.Println(recover()) }()
		base64.StdEncoding.WithPadding('A')
	}()
	func() {
		defer func() { fmt.Println(recover()) }()
		base64.StdEncoding.WithPadding('\\n')
	}()
	var cie base64.CorruptInputError = 12
	fmt.Println(cie, int64(cie))
}
`,
		`aGVsbG8gd29ybGQhIQ==
-__-AQ==
+//+AQ==
aGk -_8
true Zg== Zm8= Zm9v
16 14 12 10
61 -1
std: "hello world!!" <nil>
[251 255 254 1] <nil>
raw: "hi" <nil>
newline: "hello" <nil>
empty: "" <nil>
bang: "" illegal base64 data at input byte 0
unpadded: "hel" illegal base64 data at input byte 4
raw padded: "hel" illegal base64 data at input byte 7
trailing: "hello" illegal base64 data at input byte 8
bad pad: "hel" illegal base64 data at input byte 7
extra pad: "hel" illegal base64 data at input byte 5
one char: "" illegal base64 data at input byte 0
short pad: "" illegal base64 data at input byte 3
aGk*
custom: "hi" <nil>
custom as std: "" illegal base64 data at input byte 3
YWJj
3 [97 98 99] <nil>
x=aGk=
append: "x=hi" <nil>
encoding alphabet is not 64-bytes long
encoding alphabet contains newline character
encoding alphabet includes duplicate symbols
padding contained in alphabet
invalid padding
illegal base64 data at input byte 12 12
`,
	);
});
