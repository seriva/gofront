package main

import (
	"bytes"
	"fmt"
)

func main() {
	b := []byte("héllo")
	fmt.Println(bytes.Index(b, []byte("l")))
	fmt.Println(bytes.Index(b, []byte("é")))
	fmt.Println(bytes.Index(b, []byte("")))
	fmt.Println(bytes.Index(b, []byte("xyz")))
	fmt.Println(bytes.Index([]byte("abcabcabc"), []byte("cab")))
	fmt.Println(bytes.Index([]byte("aaaaaaab"), []byte("aaab")))

	fmt.Println(bytes.LastIndex(b, []byte("l")))
	fmt.Println(bytes.LastIndex(b, []byte("")))
	fmt.Println(bytes.LastIndex([]byte("abcabcabc"), []byte("abc")))

	fmt.Println(bytes.Contains(b, []byte("é")))
	fmt.Println(bytes.Contains(b, []byte("x")))

	fmt.Println(bytes.Count(b, []byte("l")))
	fmt.Println(bytes.Count(b, []byte("")))

	fmt.Println(string(bytes.ToValidUTF8([]byte("abc"), []byte("X"))))
	fmt.Println(string(bytes.ToValidUTF8([]byte{0x61, 0xff, 0x62}, []byte("X"))))
	fmt.Println(string(bytes.ToValidUTF8([]byte{0x61, 0xff, 0xfe, 0x62}, []byte("X"))))
	fmt.Println(string(bytes.ToValidUTF8([]byte{0xff}, []byte(""))))
}
