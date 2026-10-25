//go:build gofront

//gofront:target both

// Overlay on the emitter-backed fmt package: Fscan, Fscanf, and Fscanln
// are written in Go over io.Reader and delegate to the existing Sscan* lowering.
package fmt

import (
	"io"
)

func isSpaceByte(b byte) bool {
	return b == ' ' || b == '\t' || b == '\n' || b == '\r' || b == '\v' || b == '\f'
}

// readTokens reads whitespace-separated tokens from r until count tokens
// are found or EOF is reached. It consumes only up to the delimiter after
// the last token (or EOF).
func readTokens(r io.Reader, count int) (string, error) {
	if count <= 0 {
		return "", nil
	}
	var buf []byte
	b := make([]byte, 1)
	inToken := false
	tokensSeen := 0

	for {
		n, err := r.Read(b)
		if n > 0 {
			ch := b[0]
			if isSpaceByte(ch) {
				if inToken {
					inToken = false
					if tokensSeen >= count {
						break
					}
					buf = append(buf, ' ')
				}
			} else {
				if !inToken {
					inToken = true
					tokensSeen++
				}
				buf = append(buf, ch)
			}
		}
		if err != nil {
			if len(buf) > 0 && err == io.EOF {
				break
			}
			return string(buf), err
		}
	}
	return string(buf), nil
}

// readLine reads a line up to and including '\n' (or EOF) from r.
func readLine(r io.Reader) (string, error) {
	var buf []byte
	b := make([]byte, 1)
	for {
		n, err := r.Read(b)
		if n > 0 {
			buf = append(buf, b[0])
			if b[0] == '\n' {
				break
			}
		}
		if err != nil {
			if len(buf) > 0 && err == io.EOF {
				break
			}
			return string(buf), err
		}
	}
	return string(buf), nil
}

// Fscan scans text read from r, storing successive space-separated
// values into successive arguments. It returns the number of items
// successfully scanned. If that is less than the number of arguments,
// err will report why.
func Fscan(r io.Reader, a ...any) (n int, err error) {
	if len(a) == 0 {
		return 0, nil
	}
	s, readErr := readTokens(r, len(a))
	if len(s) == 0 && readErr != nil {
		return 0, readErr
	}
	n, scanErr := Sscan(s, a...)
	if scanErr != nil {
		return n, scanErr
	}
	if n < len(a) && readErr != nil {
		return n, readErr
	}
	return n, nil
}

// Fscanln is similar to Fscan, but stops scanning at a newline and
// after the final item there must be a newline or EOF.
func Fscanln(r io.Reader, a ...any) (n int, err error) {
	if len(a) == 0 {
		return 0, nil
	}
	s, readErr := readLine(r)
	if len(s) == 0 && readErr != nil {
		return 0, readErr
	}
	n, scanErr := Sscanln(s, a...)
	if scanErr != nil {
		return n, scanErr
	}
	if n < len(a) && readErr != nil {
		return n, readErr
	}
	return n, nil
}

// Fscanf scans text read from r, storing successive space-separated
// values into successive arguments as determined by the format. It
// returns the number of items successfully parsed.
func Fscanf(r io.Reader, format string, a ...any) (n int, err error) {
	if len(a) == 0 {
		return 0, nil
	}
	s, readErr := readLine(r)
	if len(s) == 0 && readErr != nil {
		return 0, readErr
	}
	n, scanErr := Sscanf(s, format, a...)
	if scanErr != nil {
		return n, scanErr
	}
	if n < len(a) && readErr != nil {
		return n, readErr
	}
	return n, nil
}
