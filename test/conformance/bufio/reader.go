package main

import (
	"bufio"
	"fmt"
	"io"
	"strings"
)

type memWriter struct {
	buf []byte
}

func (w *memWriter) Write(p []byte) (n int, err error) {
	w.buf = append(w.buf, p...)
	return len(p), nil
}

func (w *memWriter) String() string {
	return string(w.buf)
}

func main() {
	// 1. Errors
	fmt.Println("ErrBufferFull:", bufio.ErrBufferFull)
	fmt.Println("ErrNegativeCount:", bufio.ErrNegativeCount)
	fmt.Println("ErrInvalidUnreadByte:", bufio.ErrInvalidUnreadByte)
	fmt.Println("ErrInvalidUnreadRune:", bufio.ErrInvalidUnreadRune)

	// 2. NewReaderSize & Size
	r := strings.NewReader("abcdefghijklmnop")
	br := bufio.NewReaderSize(r, 16)
	fmt.Println("Size:", br.Size())
	fmt.Println("Buffered initial:", br.Buffered())

	// 3. Peek & Discard
	peek, err := br.Peek(4)
	fmt.Printf("Peek(4): %s, err: %v, buffered: %d\n", string(peek), err, br.Buffered())
	discarded, err := br.Discard(2)
	fmt.Printf("Discard(2): %d, err: %v, buffered: %d\n", discarded, err, br.Buffered())
	peek2, err := br.Peek(4)
	fmt.Printf("Peek(4) after discard: %s, err: %v\n", string(peek2), err)

	// 4. ReadByte & UnreadByte
	b, err := br.ReadByte()
	fmt.Printf("ReadByte: %c, err: %v\n", b, err)
	err = br.UnreadByte()
	fmt.Printf("UnreadByte err: %v\n", err)
	b, err = br.ReadByte()
	fmt.Printf("ReadByte after unread: %c, err: %v\n", b, err)

	// 5. Read
	buf := make([]byte, 5)
	n, err := br.Read(buf)
	fmt.Printf("Read(5): n=%d, s=%s, err=%v\n", n, string(buf[:n]), err)

	// 6. ReadRune & UnreadRune
	rRune := strings.NewReader("世a界")
	brRune := bufio.NewReader(rRune)
	ru, sz, err := brRune.ReadRune()
	fmt.Printf("ReadRune 1: %c, size=%d, err=%v\n", ru, sz, err)
	ru, sz, err = brRune.ReadRune()
	fmt.Printf("ReadRune 2: %c, size=%d, err=%v\n", ru, sz, err)
	err = brRune.UnreadRune()
	fmt.Printf("UnreadRune err: %v\n", err)
	ru, sz, err = brRune.ReadRune()
	fmt.Printf("ReadRune after unread: %c, size=%d, err=%v\n", ru, sz, err)
	ru, sz, err = brRune.ReadRune()
	fmt.Printf("ReadRune 3: %c, size=%d, err=%v\n", ru, sz, err)
	_, _, err = brRune.ReadRune()
	fmt.Printf("ReadRune EOF err: %v (is EOF: %v)\n", err, err == io.EOF)

	// 7. ReadSlice & ReadLine (with isPrefix)
	longLine := "first line that exceeds sixteen bytes length\r\nsecond line\nthird without newline"
	brLine := bufio.NewReaderSize(strings.NewReader(longLine), 16)
	line1, isPrefix, err := brLine.ReadLine()
	fmt.Printf("ReadLine part 1: %s, isPrefix=%v, err=%v\n", string(line1), isPrefix, err)
	line2, isPrefix, err := brLine.ReadLine()
	fmt.Printf("ReadLine part 2: %s, isPrefix=%v, err=%v\n", string(line2), isPrefix, err)
	line3, isPrefix, err := brLine.ReadLine()
	fmt.Printf("ReadLine part 3: %s, isPrefix=%v, err=%v\n", string(line3), isPrefix, err)
	line4, isPrefix, err := brLine.ReadLine()
	fmt.Printf("ReadLine line 2: %s, isPrefix=%v, err=%v\n", string(line4), isPrefix, err)
	line5, isPrefix, err := brLine.ReadLine()
	fmt.Printf("ReadLine line 3: %s, isPrefix=%v, err=%v\n", string(line5), isPrefix, err)
	line6, isPrefix, err := brLine.ReadLine()
	fmt.Printf("ReadLine EOF: len=%d, isPrefix=%v, err=%v\n", len(line6), isPrefix, err)

	// 8. ReadBytes & ReadString
	csvData := "apple,banana,orange,grape"
	brDelim := bufio.NewReader(strings.NewReader(csvData))
	s1, err := brDelim.ReadString(',')
	fmt.Printf("ReadString: %q, err=%v\n", s1, err)
	b1, err := brDelim.ReadBytes(',')
	fmt.Printf("ReadBytes: %q, err=%v\n", string(b1), err)
	s2, err := brDelim.ReadString(',')
	fmt.Printf("ReadString: %q, err=%v\n", s2, err)
	s3, err := brDelim.ReadString(',')
	fmt.Printf("ReadString final: %q, err=%v\n", s3, err)

	// 9. Reset & WriteTo
	out := &memWriter{}
	br.Reset(strings.NewReader("reset and streamed directly"))
	nw, err := br.WriteTo(out)
	fmt.Printf("WriteTo: nw=%d, err=%v, out=%s\n", nw, err, out.String())
}
