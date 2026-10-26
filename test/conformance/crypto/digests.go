package main

import (
	"crypto/md5"
	"crypto/sha1"
	"crypto/sha512"
	"fmt"
	"strings"
)

func main() {
	inputs := [][]byte{
		[]byte(""),
		[]byte("abc"),
		[]byte("The quick brown fox jumps over the lazy dog"),
		[]byte("abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq"),
		{0xe4, 0xb8, 0x96, 0xe7, 0x95, 0x8c, 0xf0, 0x9f, 0x91, 0x8b},
		[]byte(strings.Repeat("a", 1000)),
	}
	for i, in := range inputs {
		fmt.Printf("md5[%d]: %x\n", i, md5.Sum(in))
		fmt.Printf("sha1[%d]: %x\n", i, sha1.Sum(in))
		fmt.Printf("sha512[%d]: %x\n", i, sha512.Sum512(in))
		fmt.Printf("sha384[%d]: %x\n", i, sha512.Sum384(in))
		fmt.Printf("sha512/224[%d]: %x\n", i, sha512.Sum512_224(in))
		fmt.Printf("sha512/256[%d]: %x\n", i, sha512.Sum512_256(in))
	}

	h := md5.New()
	h.Write([]byte("The quick brown fox "))
	h.Write([]byte("jumps over the lazy dog"))
	fmt.Printf("md5 stream: %x\n", h.Sum(nil))
	fmt.Printf("md5 prefix: %x\n", h.Sum([]byte{1, 2}))
	h.Reset()
	fmt.Printf("md5 reset: %x\n", h.Sum(nil))
	fmt.Println(md5.Size, md5.BlockSize, h.Size(), h.BlockSize())

	s := sha1.New()
	for i := 0; i < 100; i++ {
		s.Write([]byte("0123456789"))
	}
	fmt.Printf("sha1 stream: %x\n", s.Sum(nil))
	fmt.Println(sha1.Size, sha1.BlockSize, s.Size(), s.BlockSize())

	h5 := sha512.New()
	for i := 0; i < 100; i++ {
		h5.Write([]byte("0123456789"))
	}
	fmt.Printf("sha512 stream: %x\n", h5.Sum(nil))
	fmt.Println(sha512.Size, sha512.Size224, sha512.Size256, sha512.Size384, sha512.BlockSize, h5.Size(), h5.BlockSize())
	h3 := sha512.New384()
	h3.Write([]byte("abc"))
	fmt.Printf("sha384 stream: %x %d\n", h3.Sum(nil), h3.Size())
	h3.Reset()
	fmt.Printf("sha384 reset: %x\n", h3.Sum(nil))
	h2 := sha512.New512_224()
	h2.Write([]byte("abc"))
	fmt.Printf("sha512/224 stream: %x %d\n", h2.Sum(nil), h2.Size())
	h6 := sha512.New512_256()
	h6.Write([]byte("abc"))
	fmt.Printf("sha512/256 stream: %x %d\n", h6.Sum(nil), h6.Size())
}
