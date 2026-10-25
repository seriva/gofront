package main

import (
	"bufio"
	"fmt"
	"strings"
)

type countingWriter struct {
	writes     int
	bytesCount int
	buf        []byte
}

func (w *countingWriter) Write(p []byte) (int, error) {
	w.writes++
	w.bytesCount += len(p)
	w.buf = append(w.buf, p...)
	return len(p), nil
}

func main() {
	cw := &countingWriter{}
	bw := bufio.NewWriterSize(cw, 16)

	// 1. Size & Available & Buffered
	fmt.Printf("Size: %d, Available: %d, Buffered: %d\n", bw.Size(), bw.Available(), bw.Buffered())

	// 2. Small writes (buffered)
	n, err := bw.Write([]byte("hello "))
	fmt.Printf("Write: n=%d, err=%v, writes=%d, buffered=%d\n", n, err, cw.writes, bw.Buffered())

	// 3. WriteByte
	err = bw.WriteByte('!')
	fmt.Printf("WriteByte err: %v, buffered=%d, writes=%d\n", err, bw.Buffered(), cw.writes)

	// 4. WriteRune
	sz, err := bw.WriteRune('世')
	fmt.Printf("WriteRune: sz=%d, err=%v, buffered=%d, writes=%d\n", sz, err, bw.Buffered(), cw.writes)

	// 5. AvailableBuffer
	ab := bw.AvailableBuffer()
	fmt.Printf("AvailableBuffer cap=%d, len=%d\n", cap(ab), len(ab))

	// 6. Flush
	err = bw.Flush()
	fmt.Printf("Flush err: %v, writes=%d, bytesCount=%d, out=%s\n", err, cw.writes, cw.bytesCount, string(cw.buf))

	// 7. Large write (passes through after flushing)
	bw.WriteString("prefix-")
	fmt.Printf("After WriteString: writes=%d, buffered=%d\n", cw.writes, bw.Buffered())
	largeData := "01234567890123456789012345678901"
	n, err = bw.Write([]byte(largeData))
	fmt.Printf("Large write: n=%d, err=%v, writes=%d, buffered=%d\n", n, err, cw.writes, bw.Buffered())
	bw.Flush()
	fmt.Printf("After flush: total writes=%d, total bytes=%d\n", cw.writes, cw.bytesCount)

	// 8. ReadFrom
	bw.Reset(cw)
	sr := strings.NewReader("streamed through ReadFrom")
	rfN, rfErr := bw.ReadFrom(sr)
	bw.Flush()
	fmt.Printf("ReadFrom: n=%d, err=%v, total bytes=%d\n", rfN, rfErr, cw.bytesCount)

	// 9. ReadWriter
	cr := strings.NewReader("readwriter input")
	cwr := &countingWriter{}
	rw := bufio.NewReadWriter(bufio.NewReader(cr), bufio.NewWriter(cwr))
	rwBuf := make([]byte, 10)
	rn, rerr := rw.Read(rwBuf)
	fmt.Printf("ReadWriter.Read: n=%d, str=%s, err=%v\n", rn, string(rwBuf[:rn]), rerr)
	rwn, rwerr := rw.WriteString("readwriter output")
	rw.Flush()
	fmt.Printf("ReadWriter.WriteString: n=%d, err=%v, out=%s\n", rwn, rwerr, string(cwr.buf))
}
