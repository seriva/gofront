// GoFront test suite — crypto/sha256 (Go-source)
//
// Every case runs four ways (JS and WASM, natives on and off) and must print
// what the real Go toolchain printed for the same program.

import { assertFourWay, section, test } from "../helpers.js";

section("crypto/sha256 (Go-source)");

test("FIPS vectors, io.Copy, Reset and Sum(prefix)", async () => {
	await assertFourWay(
		`package main

import (
	"bytes"
	"crypto/sha256"
	"fmt"
	"hash"
	"io"
	"strings"
)

func main() {
	fmt.Println(sha256.Size, sha256.Size224, sha256.BlockSize)
	fmt.Printf("%x\\n", sha256.Sum256(nil))
	fmt.Printf("%x\\n", sha256.Sum256([]byte("abc")))
	fmt.Printf("%x\\n", sha256.Sum256([]byte("abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq")))
	fmt.Printf("%x\\n", sha256.Sum224(nil))
	fmt.Printf("%x\\n", sha256.Sum224([]byte("abc")))
	sum := sha256.Sum256([]byte("héllo"))
	fmt.Printf("%x %d\\n", sum[:], len(sum))

	h := sha256.New()
	fmt.Println(h.Size(), h.BlockSize())
	n, err := h.Write([]byte("a"))
	fmt.Println(n, err)
	h.Write([]byte("bc"))
	fmt.Printf("%x\\n", h.Sum(nil))
	// Sum appends to its argument and keeps the state.
	fmt.Printf("%x\\n", h.Sum([]byte{1, 2}))
	h.Write([]byte("d"))
	fmt.Printf("%x\\n", h.Sum(nil))
	h.Reset()
	fmt.Printf("%x\\n", h.Sum(nil))

	// Chunks that straddle the 64-byte block boundary.
	data := bytes.Repeat([]byte("0123456789abcdef"), 40)
	whole := sha256.Sum256(data)
	for _, step := range []int{1, 7, 63, 64, 65, 200} {
		d := sha256.New()
		for i := 0; i < len(data); i += step {
			end := i + step
			if end > len(data) {
				end = len(data)
			}
			d.Write(data[i:end])
		}
		fmt.Println(step, string(d.Sum(nil)) == string(whole[:]))
	}

	var w hash.Hash = sha256.New224()
	io.Copy(w, strings.NewReader("abc"))
	fmt.Printf("%x %d\\n", w.Sum(nil), w.Size())
	var wr io.Writer = sha256.New()
	fmt.Fprintf(wr, "%s", "abc")
	fmt.Printf("%x\\n", wr.(hash.Hash).Sum(nil))

	big := sha256.New()
	chunk := bytes.Repeat([]byte("a"), 1000)
	for i := 0; i < 1000; i++ {
		big.Write(chunk)
	}
	fmt.Printf("%x\\n", big.Sum(nil))
}
`,
		`32 28 64
e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad
248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1
d14a028c2a3a2bc9476102bb288234c415a2b01f828ea62ac5b3e42f
23097d223405d8228642a477bda255b32aadbce4bda0b3f7e36c9da7
3c48591d8d098a4538f5e013dfcf406e948eac4d3277b10bf614e295d6068179 32
32 64
1 <nil>
ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad
0102ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad
88d4266fd4e6338d13b845fcf289579d209c897823b9217da3e161936f031589
e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
1 true
7 true
63 true
64 true
65 true
200 true
23097d223405d8228642a477bda255b32aadbce4bda0b3f7e36c9da7 28
ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad
cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0
`,
	);
});
