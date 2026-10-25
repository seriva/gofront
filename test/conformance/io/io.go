package main

import (
	"bytes"
	"errors"
	"fmt"
	"io"
	"strings"
)

type customByteWriter struct {
	buf []byte
}

func (w *customByteWriter) WriteByte(c byte) error {
	w.buf = append(w.buf, c)
	return nil
}

type memWriter struct {
	buf []byte
}

func (w *memWriter) Write(p []byte) (n int, err error) {
	w.buf = append(w.buf, p...)
	return len(p), nil
}

func (w *memWriter) WriteString(s string) (n int, err error) {
	bs := []byte(s)
	w.buf = append(w.buf, bs...)
	return len(s), nil
}

func (w *memWriter) String() string {
	return string(w.buf)
}

type stringReaderAt string

func (s stringReaderAt) ReadAt(p []byte, off int64) (n int, err error) {
	if off < 0 {
		return 0, errors.New("negative offset")
	}
	if off >= int64(len(s)) {
		return 0, io.EOF
	}
	sub := s[off:]
	n = copy(p, []byte(sub))
	if n < len(p) {
		err = io.EOF
	}
	return n, err
}

func main() {
	// 1. Errors
	fmt.Println("ErrUnexpectedEOF:", io.ErrUnexpectedEOF)
	fmt.Println("ErrShortWrite:", io.ErrShortWrite)
	fmt.Println("ErrShortBuffer:", io.ErrShortBuffer)
	fmt.Println("Is unexpected EOF:", errors.Is(io.ErrUnexpectedEOF, io.ErrUnexpectedEOF))

	// 2. ReadAtLeast & ReadFull
	r := strings.NewReader("Hello, GoFront!")
	buf := make([]byte, 5)
	n, err := io.ReadFull(r, buf)
	fmt.Printf("ReadFull: n=%d err=%v str=%s\n", n, err, string(buf))

	buf2 := make([]byte, 10)
	n, err = io.ReadAtLeast(r, buf2, 5)
	fmt.Printf("ReadAtLeast 5/10: n=%d err=%v str=%s\n", n, err, string(buf2[:n]))

	// ReadFull with insufficient data -> ErrUnexpectedEOF
	buf3 := make([]byte, 10)
	rShort := strings.NewReader("123")
	n, err = io.ReadFull(rShort, buf3)
	fmt.Printf("ReadFull short: n=%d err=%v\n", n, err == io.ErrUnexpectedEOF)

	// ReadAtLeast min > len(buf) -> ErrShortBuffer
	_, err = io.ReadAtLeast(r, buf[:2], 5)
	fmt.Printf("ReadAtLeast short buffer: %v\n", err == io.ErrShortBuffer)

	// 3. MultiReader
	mr := io.MultiReader(
		strings.NewReader("foo "),
		strings.NewReader("bar "),
		strings.NewReader("baz"),
	)
	var all bytes.Buffer
	b := make([]byte, 4)
	for {
		rn, rerr := mr.Read(b)
		if rn > 0 {
			all.Write(b[:rn])
		}
		if rerr == io.EOF {
			break
		}
		if rerr != nil {
			fmt.Println("MultiReader error:", rerr)
			break
		}
	}
	fmt.Println("MultiReader result:", all.String())

	// 4. MultiWriter
	var out1, out2 memWriter
	mw := io.MultiWriter(&out1, &out2)
	wn, werr := mw.Write([]byte("multi write test"))
	fmt.Printf("MultiWriter: n=%d err=%v out1=%s out2=%s\n", wn, werr, out1.String(), out2.String())

	// 5. TeeReader
	src := strings.NewReader("tee data")
	var teeBuf memWriter
	tr := io.TeeReader(src, &teeBuf)
	tread := make([]byte, 8)
	tn, _ := tr.Read(tread)
	fmt.Printf("TeeReader: read=%s teeBuf=%s\n", string(tread[:tn]), teeBuf.String())

	// 6. NopCloser
	nc := io.NopCloser(strings.NewReader("closed"))
	fmt.Printf("NopCloser close: %v\n", nc.Close())
	cp := make([]byte, 6)
	cn, _ := nc.Read(cp)
	fmt.Printf("NopCloser read: %s\n", string(cp[:cn]))

	// 7. SectionReader
	srSrc := stringReaderAt("0123456789abcdef")
	sr := io.NewSectionReader(srSrc, 4, 8)
	fmt.Printf("SectionReader Size: %d\n", sr.Size())
	sbuf := make([]byte, 4)
	sn, _ := sr.Read(sbuf)
	fmt.Printf("SectionReader Read 1: %s\n", string(sbuf[:sn]))
	sn, _ = sr.Read(sbuf)
	fmt.Printf("SectionReader Read 2: %s\n", string(sbuf[:sn]))
	_, eofErr := sr.Read(sbuf)
	fmt.Printf("SectionReader EOF: %v\n", eofErr == io.EOF)

	// Seek
	newOff, _ := sr.Seek(2, io.SeekStart)
	fmt.Printf("SectionReader Seek: off=%d\n", newOff)
	sn, _ = sr.Read(sbuf)
	fmt.Printf("SectionReader Read after seek: %s\n", string(sbuf[:sn]))

	// ReadAt
	atBuf := make([]byte, 4)
	atN, _ := sr.ReadAt(atBuf, 1)
	fmt.Printf("SectionReader ReadAt 1: %s (n=%d)\n", string(atBuf[:atN]), atN)

	// 8. ByteWriter interface check
	cbw := &customByteWriter{}
	var bw io.ByteWriter = cbw
	bw.WriteByte('A')
	bw.WriteByte('B')
	fmt.Printf("ByteWriter: %s\n", string(cbw.buf))

	// 9. StringWriter interface check
	var sw io.StringWriter = &out1
	sw.WriteString(" string writer")
	fmt.Println("StringWriter:", out1.String())
}
