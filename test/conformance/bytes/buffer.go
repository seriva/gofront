package main

import (
	"bytes"
	"fmt"
	"io"
)

func main() {
	b := bytes.NewBufferString("hello world\nline 2\n")
	fmt.Println(b.Len())

	buf := make([]byte, 5)
	n, err := b.Read(buf)
	fmt.Printf("%d %s %v\n", n, string(buf[:n]), err)

	ch, err := b.ReadByte()
	fmt.Printf("%c %v\n", ch, err)

	err = b.UnreadByte()
	fmt.Println(err == nil)
	ch, err = b.ReadByte()
	fmt.Printf("%c %v\n", ch, err)

	b2 := bytes.NewBufferString("héllo")
	rn, rsz, err := b2.ReadRune()
	fmt.Printf("%c %d %v\n", rn, rsz, err)
	err = b2.UnreadRune()
	fmt.Println(err == nil)
	rn, rsz, err = b2.ReadRune()
	fmt.Printf("%c %d %v\n", rn, rsz, err)

	line, err := b.ReadString('\n')
	fmt.Printf("%s %v\n", line, err)

	lineBytes, err := b.ReadBytes('\n')
	fmt.Printf("%s %v\n", string(lineBytes), err)

	b3 := bytes.NewBufferString("1234567890")
	nxt := b3.Next(4)
	fmt.Printf("%s %d\n", string(nxt), b3.Len())

	b3.Truncate(2)
	fmt.Printf("%d %s\n", b3.Len(), b3.String())

	fmt.Println(b3.Available() >= 0, len(b3.AvailableBuffer()))

	b4 := bytes.NewBufferString("abcdef")
	p, err := b4.Peek(3)
	fmt.Printf("%s %v %d\n", string(p), err, b4.Len())

	b5 := bytes.NewBuffer([]byte("init slice"))
	fmt.Println(b5.String())

	b5.Reset()
	b5.Grow(10)
	fmt.Println(b5.Len(), b5.Cap() >= 10)

	r := bytes.NewReader([]byte("reader test"))
	fmt.Println(r.Len(), r.Size())
	rb, _ := r.ReadByte()
	fmt.Printf("%c\n", rb)
	_ = r.UnreadByte()
	rb, _ = r.ReadByte()
	fmt.Printf("%c\n", rb)
	pos, _ := r.Seek(2, io.SeekStart)
	fmt.Println(pos)
	rbuf := make([]byte, 4)
	rn2, _ := r.ReadAt(rbuf, 0)
	fmt.Printf("%d %s\n", rn2, string(rbuf[:rn2]))
}
