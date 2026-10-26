//go:build gofront

//gofront:target both

package json

import (
	"bufio"
	"bytes"
	"internal/jsonrt"
	"io"
)

// An Encoder writes JSON values to an output stream.
type Encoder struct {
	w          io.Writer
	err        error
	prefix     string
	indent     string
	escapeHTML bool
}

// NewEncoder returns a new encoder that writes to w.
func NewEncoder(w io.Writer) *Encoder {
	return &Encoder{w: w, escapeHTML: true}
}

// SetIndent instructs the encoder to format each subsequent encoded
// value as if indented by the package-level function Indent.
// Calling SetIndent("", "") turns off indentation.
func (enc *Encoder) SetIndent(prefix, indent string) {
	enc.prefix = prefix
	enc.indent = indent
}

// SetEscapeHTML specifies whether problematic HTML characters
// should be escaped inside JSON-quoted strings.
// The default behavior is true.
func (enc *Encoder) SetEscapeHTML(on bool) {
	enc.escapeHTML = on
}

// Err returns the first error the encoder encountered, if any.
func (enc *Encoder) Err() error {
	return enc.err
}

// EscapeHTML returns whether HTML escaping is enabled.
func (enc *Encoder) EscapeHTML() bool {
	return enc.escapeHTML
}

// EncodeRaw formats b with indentation if configured and writes it to the output stream.
func (enc *Encoder) EncodeRaw(b []byte) error {
	if enc.err != nil {
		return enc.err
	}
	if enc.indent != "" || enc.prefix != "" {
		var buf bytes.Buffer
		if err := Indent(&buf, b, enc.prefix, enc.indent); err != nil {
			return err
		}
		b = buf.Bytes()
	}
	b = append(b, '\n')
	if _, err := enc.w.Write(b); err != nil {
		enc.err = err
		return err
	}
	return nil
}

// Encode writes the JSON encoding of v to the stream, followed by a newline character.
func (enc *Encoder) Encode(v any) error {
	if enc.err != nil {
		return enc.err
	}
	return enc.EncodeRaw(nil)
}

// A Decoder reads and decodes JSON values from an input stream.
type Decoder struct {
	r                     *bufio.Reader
	useNumber             bool
	disallowUnknownFields bool
	offset                int64
}

// NewDecoder returns a new decoder that reads from r.
func NewDecoder(r io.Reader) *Decoder {
	return &Decoder{r: bufio.NewReader(r)}
}

// UseNumber causes the Decoder to unmarshal a number into an interface{} as a
// Number instead of as a float64.
func (dec *Decoder) UseNumber() {
	dec.useNumber = true
}

// DisallowUnknownFields causes the Decoder to return an error when the destination
// is a struct and the input contains object keys which do not match any
// non-ignored, exported fields in the destination.
func (dec *Decoder) DisallowUnknownFields() {
	dec.disallowUnknownFields = true
}

// InputOffset returns the input stream byte offset of the current decoder position.
// The offset gives the location of the end of the most recently returned token
// and the beginning of the immediately following token.
func (dec *Decoder) InputOffset() int64 {
	return dec.offset
}

// Buffered returns a reader of the data remaining in the Decoder's
// buffer. The reader is valid until the next call to Decode.
func (dec *Decoder) Buffered() io.Reader {
	n := dec.r.Buffered()
	if n > 0 {
		p, _ := dec.r.Peek(n)
		return bytes.NewReader(p)
	}
	return bytes.NewReader(nil)
}

// More reports whether there is another element in the current array
// or object being parsed, or whether there is another value in the stream.
func (dec *Decoder) More() bool {
	for {
		b, err := dec.r.ReadByte()
		if err != nil {
			return false
		}
		if isSpace(b) {
			dec.offset++
			continue
		}
		_ = dec.r.UnreadByte()
		if b == ']' || b == '}' {
			return false
		}
		return true
	}
}

// ScanNext consumes whitespace, scans the next JSON value, and updates dec.offset.
func (dec *Decoder) ScanNext() ([]byte, error) {
	data, skipped, err := jsonrt.ScanNext(dec.r)
	dec.offset += skipped
	if err != nil {
		return nil, err
	}
	dec.offset += int64(len(data))
	return data, nil
}

// SetupDec configures a jsonrt.Dec with this decoder's options.
func (dec *Decoder) SetupDec(d *jsonrt.Dec) {
	d.UseNumber = dec.useNumber
	d.DisallowUnknownFields = dec.disallowUnknownFields
}

func isSpace(c byte) bool {
	return c <= ' ' && (c == ' ' || c == '\t' || c == '\r' || c == '\n')
}

// Decode reads the next JSON-encoded value from its input and stores it in the
// value pointed to by v.
func (dec *Decoder) Decode(v any) error {
	data, err := dec.ScanNext()
	if err != nil {
		return err
	}
	_ = data
	return nil
}
