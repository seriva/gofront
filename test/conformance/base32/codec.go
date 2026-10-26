package main

import (
	"encoding/base32"
	"fmt"
	"io"
)

// sink and source are plain io.Writer / io.Reader implementations.
type sink struct{ b []byte }

func (s *sink) Write(p []byte) (int, error) {
	s.b = append(s.b, p...)
	return len(p), nil
}

type source struct {
	b []byte
	i int
}

func (s *source) Read(p []byte) (int, error) {
	if s.i >= len(s.b) {
		return 0, io.EOF
	}
	n := copy(p, s.b[s.i:])
	s.i += n
	return n, nil
}

func main() {
	// RFC 4648 section 10 vectors.
	vectors := []string{"", "f", "fo", "foo", "foob", "fooba", "foobar"}
	for _, v := range vectors {
		std := base32.StdEncoding.EncodeToString([]byte(v))
		hex := base32.HexEncoding.EncodeToString([]byte(v))
		raw := base32.StdEncoding.WithPadding(base32.NoPadding).EncodeToString([]byte(v))
		fmt.Printf("%q std=%s hex=%s raw=%s\n", v, std, hex, raw)
		back, err := base32.StdEncoding.DecodeString(std)
		fmt.Printf("  decode %q %v\n", back, err)
		back, err = base32.HexEncoding.DecodeString(hex)
		fmt.Printf("  decode hex %q %v\n", back, err)
		back, err = base32.StdEncoding.WithPadding(base32.NoPadding).DecodeString(raw)
		fmt.Printf("  decode raw %q %v\n", back, err)
	}

	// Binary input, lengths.
	data := []byte{0x00, 0xff, 0x10, 0x80, 0x7f, 0xe4, 0xb8, 0x96}
	s := base32.StdEncoding.EncodeToString(data)
	fmt.Println(s, base32.StdEncoding.EncodedLen(len(data)), base32.StdEncoding.DecodedLen(len(s)))
	fmt.Println(base32.StdEncoding.WithPadding(base32.NoPadding).EncodedLen(len(data)), base32.StdEncoding.WithPadding(base32.NoPadding).DecodedLen(13))
	got, err := base32.StdEncoding.DecodeString(s)
	fmt.Println(got, err)

	// Errors.
	for _, bad := range []string{"MZXW6===!", "MZXW6", "M", "mzxw6ytb", "MZXW6YTB=", "MZXW6YTBOI======\n", "========"} {
		_, err := base32.StdEncoding.DecodeString(bad)
		fmt.Printf("%q: %v\n", bad, err)
	}
	var cie base32.CorruptInputError = 7
	fmt.Println(cie.Error())

	// Newlines are ignored when decoding.
	got, err = base32.StdEncoding.DecodeString("MZXW6YTB\nOI======\r\n")
	fmt.Printf("%q %v\n", got, err)

	// Encode / Decode into buffers, Append forms.
	dst := make([]byte, base32.StdEncoding.EncodedLen(3))
	base32.StdEncoding.Encode(dst, []byte("foo"))
	fmt.Println(string(dst))
	out := make([]byte, base32.StdEncoding.DecodedLen(len(dst)))
	n, err := base32.StdEncoding.Decode(out, dst)
	fmt.Println(n, err, string(out[:n]))
	fmt.Println(string(base32.StdEncoding.AppendEncode([]byte("x:"), []byte("foobar"))))
	ap, err := base32.StdEncoding.AppendDecode([]byte("x:"), []byte("MZXW6YTBOI======"))
	fmt.Println(string(ap), err)

	// Custom alphabet and custom padding.
	enc := base32.NewEncoding("ABCDEFGHIJKLMNOPQRSTUVWXYZ234567").WithPadding('*')
	fmt.Println(enc.EncodeToString([]byte("foob")))
	pb, err := enc.DecodeString("MZXW6YQ*")
	fmt.Printf("%q %v\n", pb, err)

	// Streaming encoder and decoder.
	buf := &sink{}
	w := base32.NewEncoder(base32.StdEncoding, buf)
	w.Write([]byte("foo"))
	w.Write([]byte("bar"))
	fmt.Println(w.Close())
	fmt.Println(string(buf.b))
	r := base32.NewDecoder(base32.StdEncoding, &source{b: buf.b})
	rb := make([]byte, 16)
	rn, err := r.Read(rb)
	fmt.Printf("%q %v\n", rb[:rn], err)
	fmt.Println(base32.StdPadding, base32.NoPadding)
}
