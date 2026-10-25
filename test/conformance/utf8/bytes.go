package main

import (
	"fmt"
	"unicode/utf8"
)

func main() {
	// EncodeRune & AppendRune
	var buf [4]byte
	n := utf8.EncodeRune(buf[:], 'A')
	fmt.Printf("Encode ASCII: %d %x\n", n, buf[:n])
	n = utf8.EncodeRune(buf[:], 'é')
	fmt.Printf("Encode 2-byte: %d %x\n", n, buf[:n])
	n = utf8.EncodeRune(buf[:], '界')
	fmt.Printf("Encode 3-byte: %d %x\n", n, buf[:n])
	n = utf8.EncodeRune(buf[:], '\U0001F680')
	fmt.Printf("Encode 4-byte: %d %x\n", n, buf[:n])
	n = utf8.EncodeRune(buf[:], -1)
	fmt.Printf("Encode invalid: %d %x\n", n, buf[:n])

	var b []byte
	b = utf8.AppendRune(b, 'H')
	b = utf8.AppendRune(b, 'e')
	b = utf8.AppendRune(b, 'l')
	b = utf8.AppendRune(b, 'l')
	b = utf8.AppendRune(b, 'o')
	b = utf8.AppendRune(b, ' ')
	b = utf8.AppendRune(b, '世')
	b = utf8.AppendRune(b, '界')
	b = utf8.AppendRune(b, '!')
	fmt.Printf("Append: %s (%d bytes)\n", string(b), len(b))

	// DecodeRune
	sample := []byte("Hello 世界 \U0001F680")
	pos := 0
	for pos < len(sample) {
		r, sz := utf8.DecodeRune(sample[pos:])
		fmt.Printf("Decode at %d: %c (%U) size=%d\n", pos, r, r, sz)
		pos += sz
	}
	r, sz := utf8.DecodeRune([]byte{})
	fmt.Printf("Decode empty: %U size=%d\n", r, sz)
	r, sz = utf8.DecodeRune([]byte{0xff})
	fmt.Printf("Decode invalid: %U size=%d\n", r, sz)

	// DecodeLastRune
	pos = len(sample)
	for pos > 0 {
		r, sz := utf8.DecodeLastRune(sample[:pos])
		fmt.Printf("DecodeLast at %d: %c (%U) size=%d\n", pos, r, r, sz)
		pos -= sz
	}
	r, sz = utf8.DecodeLastRune([]byte{})
	fmt.Printf("DecodeLast empty: %U size=%d\n", r, sz)
	r, sz = utf8.DecodeLastRune([]byte{0xff})
	fmt.Printf("DecodeLast invalid: %U size=%d\n", r, sz)

	// RuneCount
	fmt.Printf("RuneCount sample: %d\n", utf8.RuneCount(sample))
	fmt.Printf("RuneCount empty: %d\n", utf8.RuneCount([]byte{}))
	fmt.Printf("RuneCount with invalid: %d\n", utf8.RuneCount([]byte("abc\xffdef")))

	// FullRune
	fmt.Printf("FullRune empty: %v\n", utf8.FullRune([]byte{}))
	fmt.Printf("FullRune ASCII: %v\n", utf8.FullRune([]byte("a")))
	fmt.Printf("FullRune partial 2-byte: %v\n", utf8.FullRune([]byte{0xc3}))
	fmt.Printf("FullRune full 2-byte: %v\n", utf8.FullRune([]byte{0xc3, 0xa9}))
	fmt.Printf("FullRune partial 3-byte: %v\n", utf8.FullRune([]byte{0xe4, 0xb8}))
	fmt.Printf("FullRune full 3-byte: %v\n", utf8.FullRune([]byte{0xe4, 0xb8, 0x96}))
	fmt.Printf("FullRune partial 4-byte: %v\n", utf8.FullRune([]byte{0xf0, 0x9f, 0x9a}))
	fmt.Printf("FullRune full 4-byte: %v\n", utf8.FullRune([]byte{0xf0, 0x9f, 0x9a, 0x80}))
	fmt.Printf("FullRune invalid byte: %v\n", utf8.FullRune([]byte{0xff}))

	// Valid
	fmt.Printf("Valid sample: %v\n", utf8.Valid(sample))
	fmt.Printf("Valid empty: %v\n", utf8.Valid([]byte{}))
	fmt.Printf("Valid truncated: %v\n", utf8.Valid([]byte{0xc3}))
	fmt.Printf("Valid invalid 0xff: %v\n", utf8.Valid([]byte{0xff}))
	fmt.Printf("Valid surrogate: %v\n", utf8.Valid([]byte{0xed, 0xa0, 0x80}))

	// RuneStart & RuneSelf
	fmt.Printf("RuneSelf: %d\n", utf8.RuneSelf)
	fmt.Printf("RuneStart 'a': %v\n", utf8.RuneStart('a'))
	fmt.Printf("RuneStart 0xc3: %v\n", utf8.RuneStart(0xc3))
	fmt.Printf("RuneStart 0x80: %v\n", utf8.RuneStart(0x80))
}
