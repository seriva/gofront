//go:build gofront

//gofront:target both

package json

import (
	"bytes"
	"internal/jsonrt"
)

var hexDigits = []byte("0123456789abcdef")

func escapeLen(src []byte, i int) int {
	c := src[i]
	if c == '<' || c == '>' || c == '&' {
		return 1
	}
	if c == 0xE2 && i+2 < len(src) && src[i+1] == 0x80 && (src[i+2]&^1) == 0xA8 {
		return 3
	}
	return 0
}

// HTMLEscape appends to dst the JSON-encoded src with <, >, &, U+2028 and U+2029
// characters inside string literals changed to \u003c, \u003e, \u0026, \u2028, \u2029
// so that the JSON will be safe to embed inside HTML <script> tags.
func HTMLEscape(dst *bytes.Buffer, src []byte) {
	start := 0
	for i := 0; i < len(src); {
		n := escapeLen(src, i)
		if n == 0 {
			i++
			continue
		}
		if start < i {
			dst.Write(src[start:i])
		}
		if n == 1 {
			c := src[i]
			dst.Write([]byte{'\\', 'u', '0', '0', hexDigits[c>>4], hexDigits[c&0xF]})
			i++
		} else {
			dst.Write([]byte{'\\', 'u', '2', '0', '2', hexDigits[src[i+2]&0xF]})
			i += 3
		}
		start = i
	}
	if start < len(src) {
		dst.Write(src[start:])
	}
}

// Compact appends to dst the JSON-encoded src with
// insignificant space characters elided.
func Compact(dst *bytes.Buffer, src []byte) error {
	b, err := jsonrt.AppendCompact(nil, src, false)
	if len(b) > 0 {
		dst.Write(b)
	}
	return err
}

// Indent appends to dst an indented form of the JSON-encoded src.
func Indent(dst *bytes.Buffer, src []byte, prefix, indent string) error {
	b, err := jsonrt.AppendIndent(nil, src, prefix, indent)
	if len(b) > 0 {
		dst.Write(b)
	}
	return err
}
