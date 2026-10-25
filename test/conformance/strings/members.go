package main

import (
	"fmt"
	"io"
	"strings"
)

func main() {
	// ToValidUTF8
	fmt.Println(strings.ToValidUTF8("hello", "X"))
	fmt.Println(strings.ToValidUTF8("héllo", "X"))

	// NewReader
	r := strings.NewReader("hello world")
	fmt.Println(r.Len(), r.Size())

	b := make([]byte, 5)
	n, err := r.Read(b)
	fmt.Printf("%d %s %v\n", n, string(b[:n]), err)

	ch, err := r.ReadByte()
	fmt.Printf("%c %v\n", ch, err)

	err = r.UnreadByte()
	fmt.Println(err == nil)

	ch, err = r.ReadByte()
	fmt.Printf("%c %v\n", ch, err)

	r2 := strings.NewReader("héllo")
	rn, rsz, err := r2.ReadRune()
	fmt.Printf("%c %d %v\n", rn, rsz, err)
	rn, rsz, err = r2.ReadRune()
	fmt.Printf("%c %d %v\n", rn, rsz, err)
	err = r2.UnreadRune()
	fmt.Println(err == nil)
	rn, rsz, err = r2.ReadRune()
	fmt.Printf("%c %d %v\n", rn, rsz, err)

	atBuf := make([]byte, 4)
	n, err = r.ReadAt(atBuf, 6)
	fmt.Printf("%d %s %v\n", n, string(atBuf[:n]), err)

	pos, err := r.Seek(0, io.SeekStart)
	fmt.Printf("%d %v\n", pos, err)
	pos, err = r.Seek(2, io.SeekCurrent)
	fmt.Printf("%d %v\n", pos, err)
	pos, err = r.Seek(-3, io.SeekEnd)
	fmt.Printf("%d %v\n", pos, err)

	r.Reset("reset string")
	fmt.Println(r.Len(), r.Size())
}
