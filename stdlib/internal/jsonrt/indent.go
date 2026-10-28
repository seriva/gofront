// Copyright 2010 The Go Authors. All rights reserved.
// Use of this source code is governed by a BSD-style
// license that can be found in the LICENSE file.

//go:build gofront

//gofront:target both

package jsonrt

var hexDigits = []byte("0123456789abcdef")

func appendStr(dst []byte, s string) []byte {
	for i := 0; i < len(s); i++ {
		dst = append(dst, s[i])
	}
	return dst
}

// compactEscape escapes the byte at src[i] when escape is set and it is <, >
// or & or begins U+2028/U+2029 (E2 80 A8 and E2 80 A9). It returns the grown
// dst and the new start of the pending unescaped run.
func compactEscape(dst, src []byte, i, start int, escape bool) ([]byte, int) {
	c := src[i]
	if !escape {
		return dst, start
	}
	if c == '<' || c == '>' || c == '&' {
		dst = append(dst, src[start:i]...)
		dst = append(dst, '\\', 'u', '0', '0', hexDigits[c>>4], hexDigits[c&0xF])
		return dst, i + 1
	}
	if c == 0xE2 && i+2 < len(src) && src[i+1] == 0x80 && src[i+2]&^1 == 0xA8 {
		dst = append(dst, src[start:i]...)
		dst = append(dst, '\\', 'u', '2', '0', '2', hexDigits[src[i+2]&0xF])
		return dst, i + 3
	}
	return dst, start
}

// AppendCompact appends to dst the JSON-encoded src with insignificant space
// characters elided. With escape, <, >, & and U+2028/U+2029 are escaped too.
func AppendCompact(dst, src []byte, escape bool) ([]byte, error) {
	origLen := len(dst)
	scan := newScanner()
	start := 0
	for i, c := range src {
		dst, start = compactEscape(dst, src, i, start, escape)
		v := scan.step(scan, c)
		if v >= scanSkipSpace {
			if v == scanError {
				break
			}
			if start < i {
				dst = append(dst, src[start:i]...)
			}
			start = i + 1
		}
	}
	if scan.eof() == scanError {
		return dst[:origLen], scan.err
	}
	if start < len(src) {
		dst = append(dst, src[start:]...)
	}
	return dst, nil
}

func appendNewline(dst []byte, prefix, indent string, depth int) []byte {
	dst = append(dst, '\n')
	dst = appendStr(dst, prefix)
	for i := 0; i < depth; i++ {
		dst = appendStr(dst, indent)
	}
	return dst
}

// AppendIndent appends to dst an indented form of the JSON-encoded src.
func AppendIndent(dst, src []byte, prefix, indent string) ([]byte, error) {
	origLen := len(dst)
	scan := newScanner()
	needIndent := false
	depth := 0
	for _, c := range src {
		scan.bytes++
		v := scan.step(scan, c)
		if v == scanSkipSpace {
			continue
		}
		if v == scanError {
			break
		}
		if needIndent && v != scanEndObject && v != scanEndArray {
			needIndent = false
			depth++
			dst = appendNewline(dst, prefix, indent, depth)
		}

		// Emit semantically uninteresting bytes
		// (in particular, punctuation in strings) unmodified.
		if v == scanContinue {
			dst = append(dst, c)
			continue
		}

		// Add spacing around real punctuation.
		switch c {
		case '{', '[':
			// delay indent so that empty object and array are formatted as {} and [].
			needIndent = true
			dst = append(dst, c)
		case ',':
			dst = append(dst, c)
			dst = appendNewline(dst, prefix, indent, depth)
		case ':':
			dst = append(dst, c)
			dst = append(dst, ' ')
		case '}', ']':
			if needIndent {
				// suppress indent in empty object/array
				needIndent = false
			} else {
				depth--
				dst = appendNewline(dst, prefix, indent, depth)
			}
			dst = append(dst, c)
		default:
			dst = append(dst, c)
		}
	}
	if scan.eof() == scanError {
		return dst[:origLen], scan.err
	}
	return dst, nil
}
