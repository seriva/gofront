//go:build gofront

//gofront:target both

package jsonrt

import "io"

const readerBufSize = 4096

// Reader is the minimal buffered byte reader behind json.Decoder. It offers
// only what ScanNext and the Decoder need: single-byte reads with one byte of
// unread, and access to the bytes still buffered.
type Reader struct {
	rd  io.Reader
	buf []byte
	r   int
	w   int
	err error
}

// NewReader returns a Reader that reads from rd.
func NewReader(rd io.Reader) *Reader {
	return &Reader{rd: rd, buf: make([]byte, readerBufSize)}
}

// ReadByte returns the next byte, or the error that ended the input.
func (b *Reader) ReadByte() (byte, error) {
	for b.r == b.w {
		if b.err != nil {
			err := b.err
			b.err = nil
			return 0, err
		}
		b.fill()
	}
	c := b.buf[b.r]
	b.r++
	return c, nil
}

// UnreadByte steps back over the byte most recently returned by ReadByte.
func (b *Reader) UnreadByte() {
	if b.r > 0 {
		b.r--
	}
}

// Buffered returns the bytes that were read from the source but not consumed.
// The slice is valid until the next read.
func (b *Reader) Buffered() []byte {
	return b.buf[b.r:b.w]
}

func (b *Reader) fill() {
	if b.r > 0 {
		copy(b.buf, b.buf[b.r:b.w])
		b.w -= b.r
		b.r = 0
	}
	for i := 0; i < 100; i++ {
		n, err := b.rd.Read(b.buf[b.w:])
		b.w += n
		if err != nil {
			b.err = err
			return
		}
		if n > 0 {
			return
		}
	}
	b.err = io.ErrNoProgress
}
