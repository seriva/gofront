//go:build gofront
//gofront:target both

package bufio

import (
	"bytes"
	"errors"
	"io"
	"unicode/utf8"
)

type Scanner struct {
	r            io.Reader
	split        SplitFunc
	maxTokenSize int
	token        []byte
	buf          []byte
	start        int
	end          int
	err          error
	empties      int
	scanCalled   bool
	done         bool
}

type SplitFunc func(data []byte, atEOF bool) (advance int, token []byte, err error)

var (
	ErrTooLong         = errors.New("bufio.Scanner: token too long")
	ErrNegativeAdvance = errors.New("bufio.Scanner: SplitFunc returns negative advance count")
	ErrAdvanceTooFar   = errors.New("bufio.Scanner: SplitFunc returns advance count beyond input")
	ErrBadReadCount    = errors.New("bufio.Scanner: Read returned impossible count")
	ErrFinalToken      = errors.New("final token")
)

const (
	MaxScanTokenSize = 64 * 1024
	startBufSize     = 4096
)

func NewScanner(r io.Reader) *Scanner {
	return &Scanner{
		r:            r,
		split:        ScanLines,
		maxTokenSize: MaxScanTokenSize,
	}
}

func (s *Scanner) Err() error {
	if s.err == io.EOF {
		return nil
	}
	return s.err
}

func (s *Scanner) Bytes() []byte {
	return s.token
}

func (s *Scanner) Text() string {
	return string(s.token)
}

func (s *Scanner) resizeBuffer() bool {
	if len(s.buf) >= s.maxTokenSize {
		s.setErr(ErrTooLong)
		return false
	}
	newSize := len(s.buf) * 2
	if newSize == 0 {
		newSize = startBufSize
	}
	if newSize > s.maxTokenSize {
		newSize = s.maxTokenSize
	}
	newBuf := make([]byte, newSize)
	copy(newBuf, s.buf[s.start:s.end])
	s.buf = newBuf
	s.end -= s.start
	s.start = 0
	return true
}

func (s *Scanner) readFromSource() {
	for loop := 0; ; {
		n, err := s.r.Read(s.buf[s.end:len(s.buf)])
		if n < 0 || len(s.buf)-s.end < n {
			s.setErr(ErrBadReadCount)
			break
		}
		s.end += n
		if err != nil {
			s.setErr(err)
			break
		}
		if n > 0 {
			s.empties = 0
			break
		}
		loop++
		if loop > maxConsecutiveEmptyReads {
			s.setErr(io.ErrNoProgress)
			break
		}
	}
}

func (s *Scanner) checkSplit() (bool, bool) {
	if s.end <= s.start && s.err == nil {
		return false, true
	}
	advance, token, err := s.split(s.buf[s.start:s.end], s.err != nil)
	if err != nil {
		if err == ErrFinalToken {
			s.token = token
			s.done = true
			return token != nil, false
		}
		s.setErr(err)
		return false, false
	}
	if !s.advance(advance) {
		return false, false
	}
	s.token = token
	if token != nil {
		if s.err == nil || advance > 0 {
			s.empties = 0
		} else {
			s.empties++
			if s.empties > maxConsecutiveEmptyReads {
				panic("bufio.Scan: too many empty tokens without progressing")
			}
		}
		return true, false
	}
	return false, true
}

func (s *Scanner) Scan() bool {
	if s.done {
		return false
	}
	s.scanCalled = true
	for {
		hasToken, cont := s.checkSplit()
		if !cont {
			return hasToken
		}

		if s.err != nil {
			s.start = 0
			s.end = 0
			return false
		}

		if s.start > 0 && (s.end == len(s.buf) || s.start > len(s.buf)/2) {
			copy(s.buf, s.buf[s.start:s.end])
			s.end -= s.start
			s.start = 0
		}

		if s.end == len(s.buf) && !s.resizeBuffer() {
			return false
		}

		s.readFromSource()
	}
}

func (s *Scanner) advance(n int) bool {
	if n < 0 {
		s.setErr(ErrNegativeAdvance)
		return false
	}
	if n > s.end-s.start {
		s.setErr(ErrAdvanceTooFar)
		return false
	}
	s.start += n
	return true
}

func (s *Scanner) setErr(err error) {
	if s.err == nil || s.err == io.EOF {
		s.err = err
	}
}

func (s *Scanner) Buffer(buf []byte, max int) {
	if s.scanCalled {
		panic("Buffer called after Scan")
	}
	s.buf = buf[0:cap(buf)]
	s.maxTokenSize = max
}

func (s *Scanner) Split(split SplitFunc) {
	if s.scanCalled {
		panic("Split called after Scan")
	}
	s.split = split
}

func ScanBytes(data []byte, atEOF bool) (advance int, token []byte, err error) {
	if atEOF && len(data) == 0 {
		return 0, nil, nil
	}
	return 1, data[0:1], nil
}

var errorRune = []byte{0xef, 0xbf, 0xbd}

func ScanRunes(data []byte, atEOF bool) (advance int, token []byte, err error) {
	if atEOF && len(data) == 0 {
		return 0, nil, nil
	}

	if data[0] < utf8.RuneSelf {
		return 1, data[0:1], nil
	}

	_, width := utf8.DecodeRune(data)
	if width > 1 {
		return width, data[0:width], nil
	}

	if !atEOF && !utf8.FullRune(data) {
		return 0, nil, nil
	}

	return 1, errorRune, nil
}

func dropCR(data []byte) []byte {
	if len(data) > 0 && data[len(data)-1] == '\r' {
		return data[0 : len(data)-1]
	}
	return data
}

func ScanLines(data []byte, atEOF bool) (advance int, token []byte, err error) {
	if atEOF && len(data) == 0 {
		return 0, nil, nil
	}
	if i := bytes.IndexByte(data, '\n'); i >= 0 {
		return i + 1, dropCR(data[0:i]), nil
	}
	if atEOF {
		return len(data), dropCR(data), nil
	}
	return 0, nil, nil
}

func isLatinSpace(r rune) bool {
	switch r {
	case ' ', '\t', '\n', '\v', '\f', '\r', '\u0085', '\u00A0':
		return true
	}
	return false
}

func isUnicodeSpace(r rune) bool {
	if r >= '\u2000' && r <= '\u200a' {
		return true
	}
	switch r {
	case '\u1680', '\u2028', '\u2029', '\u202f', '\u205f', '\u3000':
		return true
	}
	return false
}

func isSpace(r rune) bool {
	if r <= '\u00FF' {
		return isLatinSpace(r)
	}
	return isUnicodeSpace(r)
}

func ScanWords(data []byte, atEOF bool) (advance int, token []byte, err error) {
	start := 0
	for width := 0; start < len(data); start += width {
		var r rune
		r, width = utf8.DecodeRune(data[start:])
		if !isSpace(r) {
			break
		}
	}
	for width, i := 0, start; i < len(data); i += width {
		var r rune
		r, width = utf8.DecodeRune(data[i:])
		if isSpace(r) {
			return i + width, data[start:i], nil
		}
	}
	if atEOF && len(data) > start {
		return len(data), data[start:], nil
	}
	return start, nil, nil
}
