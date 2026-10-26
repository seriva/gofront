package main

import (
	"crypto/hmac"
	"crypto/md5"
	"crypto/sha1"
	"crypto/sha512"
	"crypto/subtle"
	"fmt"
	"hash"
)

func rep(b byte, n int) []byte {
	out := make([]byte, n)
	for i := range out {
		out[i] = b
	}
	return out
}

func main() {
	// RFC 4231 test cases 1, 2, 3, 6 and 7 (keys of 20, 4, 20, 131 bytes).
	cases := []struct{ key, data []byte }{
		{rep(0x0b, 20), []byte("Hi There")},
		{[]byte("Jefe"), []byte("what do ya want for nothing?")},
		{rep(0xaa, 20), rep(0xdd, 50)},
		{rep(0xaa, 131), []byte("Test Using Larger Than Block-Size Key - Hash Key First")},
		{rep(0xaa, 131), []byte("This is a test using a larger than block-size key and a larger than block-size data. The key needs to be hashed before being used by the HMAC algorithm.")},
	}
	for i, c := range cases {
		m := hmac.New(sha512.New, c.key)
		m.Write(c.data)
		fmt.Printf("hmac-sha512[%d]: %x\n", i, m.Sum(nil))
		m = hmac.New(sha512.New384, c.key)
		m.Write(c.data)
		fmt.Printf("hmac-sha384[%d]: %x\n", i, m.Sum(nil))
		m = hmac.New(sha1.New, c.key)
		m.Write(c.data)
		fmt.Printf("hmac-sha1[%d]: %x\n", i, m.Sum(nil))
		m = hmac.New(md5.New, c.key)
		m.Write(c.data)
		fmt.Printf("hmac-md5[%d]: %x\n", i, m.Sum(nil))
	}

	// Streaming, Reset, Sum with a prefix, and sizes.
	var mk func() hash.Hash = sha1.New
	m := hmac.New(mk, []byte("key"))
	m.Write([]byte("The quick brown fox "))
	m.Write([]byte("jumps over the lazy dog"))
	mac := m.Sum(nil)
	fmt.Printf("stream: %x\n", mac)
	fmt.Printf("prefixed: %x\n", m.Sum([]byte{1, 2}))
	fmt.Println(m.Size(), m.BlockSize())
	m.Reset()
	m.Write([]byte("The quick brown fox jumps over the lazy dog"))
	fmt.Println(hmac.Equal(mac, m.Sum(nil)), hmac.Equal(mac, mac[:5]), hmac.Equal(mac, rep(0, 20)))

	// crypto/subtle
	a := []byte("abcdef")
	b := []byte("abcdef")
	c := []byte("abcdeg")
	fmt.Println(subtle.ConstantTimeCompare(a, b), subtle.ConstantTimeCompare(a, c), subtle.ConstantTimeCompare(a, a[:3]), subtle.ConstantTimeCompare(nil, nil))
	fmt.Println(subtle.ConstantTimeSelect(1, 7, 9), subtle.ConstantTimeSelect(0, 7, 9))
	fmt.Println(subtle.ConstantTimeByteEq(5, 5), subtle.ConstantTimeByteEq(5, 6), subtle.ConstantTimeByteEq(255, 0))
	fmt.Println(subtle.ConstantTimeEq(-3, -3), subtle.ConstantTimeEq(3, -3), subtle.ConstantTimeEq(0, 0), subtle.ConstantTimeEq(1<<30, 0))
	fmt.Println(subtle.ConstantTimeLessOrEq(3, 4), subtle.ConstantTimeLessOrEq(4, 4), subtle.ConstantTimeLessOrEq(5, 4), subtle.ConstantTimeLessOrEq(0, 0))
	x := []byte{1, 2, 3}
	subtle.ConstantTimeCopy(0, x, []byte{9, 9, 9})
	fmt.Println(x)
	subtle.ConstantTimeCopy(1, x, []byte{9, 8, 7})
	fmt.Println(x)
	dst := make([]byte, 4)
	n := subtle.XORBytes(dst, []byte{0xff, 0x0f, 0xf0}, []byte{0x0f, 0x0f, 0x0f, 0x01})
	fmt.Println(n, dst)
	ran := false
	subtle.WithDataIndependentTiming(func() { ran = true })
	fmt.Println(ran)
}
