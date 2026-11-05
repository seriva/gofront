// GoFront test suite — encoding/binary (Go-source)
//
// Every case runs four ways (JS and WASM, natives on and off) and must print
// what the real Go toolchain printed for the same program.

import { assertFourWay, section, test } from "../helpers.js";

section("encoding/binary (Go-source)");

test("byte orders, varints and the Read/Write members match Go", async () => {
	await assertFourWay(
		`package main

import (
	"bytes"
	"encoding/binary"
	"fmt"
)

func main() {
	b := make([]byte, 8)
	binary.LittleEndian.PutUint16(b, 0x1234)
	fmt.Println(b[:2], binary.LittleEndian.Uint16(b), binary.BigEndian.Uint16(b))
	binary.BigEndian.PutUint32(b, 0xdeadbeef)
	fmt.Println(b[:4], binary.BigEndian.Uint32(b), binary.LittleEndian.Uint32(b))
	binary.LittleEndian.PutUint64(b, 0x0102030405060708)
	fmt.Println(b, binary.LittleEndian.Uint64(b), binary.BigEndian.Uint64(b))
	binary.BigEndian.PutUint64(b, 18446744073709551615)
	fmt.Println(b, binary.BigEndian.Uint64(b))

	var out []byte
	out = binary.BigEndian.AppendUint16(out, 0x0102)
	out = binary.LittleEndian.AppendUint32(out, 0x01020304)
	out = binary.BigEndian.AppendUint64(out, 0x0a0b0c0d0e0f1011)
	fmt.Println(out)

	var order binary.ByteOrder = binary.BigEndian
	var app binary.AppendByteOrder = binary.LittleEndian
	fmt.Println(order, app, order.Uint16([]byte{1, 2}))
	fmt.Printf("%v %s\\n", binary.LittleEndian, binary.BigEndian)

	for _, v := range []uint64{0, 1, 127, 128, 300, 16384, 1<<63 - 1, 1<<64 - 1} {
		buf := binary.AppendUvarint(nil, v)
		got, n := binary.Uvarint(buf)
		fmt.Println(v, buf, got, n)
	}
	for _, v := range []int64{0, -1, 1, -64, 64, -65, 1<<63 - 1, -1 << 63} {
		buf := make([]byte, binary.MaxVarintLen64)
		n := binary.PutVarint(buf, v)
		got, m := binary.Varint(buf[:n])
		fmt.Println(v, buf[:n], got, m)
	}
	fmt.Println(binary.MaxVarintLen16, binary.MaxVarintLen32, binary.MaxVarintLen64)

	fmt.Println(binary.Uvarint(nil))
	fmt.Println(binary.Uvarint([]byte{0x80}))
	fmt.Println(binary.Uvarint([]byte{0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0x02}))
	fmt.Println(binary.Uvarint([]byte{0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0x01}))
	fmt.Println(binary.Uvarint([]byte{0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0x01}))

	r := bytes.NewReader([]byte{0xac, 0x02, 0x80})
	u, err := binary.ReadUvarint(r)
	fmt.Println(u, err)
	u, err = binary.ReadUvarint(r)
	fmt.Println(u, err)
	u, err = binary.ReadUvarint(r)
	fmt.Println(u, err)
	s, err := binary.ReadVarint(bytes.NewReader([]byte{0x01}))
	fmt.Println(s, err)
	_, err = binary.ReadUvarint(bytes.NewReader(bytes.Repeat([]byte{0xff}, 11)))
	fmt.Println(err)

	func() {
		defer func() { fmt.Println(recover()) }()
		binary.LittleEndian.Uint32([]byte{1, 2})
	}()
	func() {
		defer func() { fmt.Println(recover()) }()
		binary.PutUvarint(make([]byte, 1), 300)
	}()

	// Read and Write take the byte orders above.
	var buf bytes.Buffer
	fmt.Println(binary.Write(&buf, binary.BigEndian, uint32(0x01020304)), binary.Write(&buf, binary.LittleEndian, int16(-2)))
	fmt.Println(buf.Bytes())
	var x uint32
	var y int16
	fmt.Println(binary.Read(&buf, binary.BigEndian, &x), binary.Read(&buf, binary.LittleEndian, &y), x, y)
	fmt.Println(binary.Read(&buf, binary.LittleEndian, &y))
}
`,
		`[52 18] 4660 13330
[222 173 190 239] 3735928559 4022250974
[8 7 6 5 4 3 2 1] 72623859790382856 578437695752307201
[255 255 255 255 255 255 255 255] 18446744073709551615
[1 2 4 3 2 1 10 11 12 13 14 15 16 17]
BigEndian LittleEndian 258
LittleEndian BigEndian
0 [0] 0 1
1 [1] 1 1
127 [127] 127 1
128 [128 1] 128 2
300 [172 2] 300 2
16384 [128 128 1] 16384 3
9223372036854775807 [255 255 255 255 255 255 255 255 127] 9223372036854775807 9
18446744073709551615 [255 255 255 255 255 255 255 255 255 1] 18446744073709551615 10
0 [0] 0 1
-1 [1] -1 1
1 [2] 1 1
-64 [127] -64 1
64 [128 1] 64 2
-65 [129 1] -65 2
9223372036854775807 [254 255 255 255 255 255 255 255 255 1] 9223372036854775807 10
-9223372036854775808 [255 255 255 255 255 255 255 255 255 1] -9223372036854775808 10
3 5 10
0 0
0 0
0 -10
0 -11
18446744073709551615 10
300 <nil>
0 unexpected EOF
0 EOF
-1 <nil>
binary: varint overflows a 64-bit integer
runtime error: index out of range [3] with length 2
runtime error: index out of range [1] with length 1
<nil> <nil>
[1 2 3 4 254 255]
<nil> <nil> 16909060 -2
EOF
`,
	);
});

test("Read into 64-bit integers and Size of named structs match Go", async () => {
	await assertFourWay(
		`package main

import (
	"bytes"
	"encoding/binary"
	"fmt"
)

type Point struct{ X, Y int32 }

func main() {
	buf := bytes.NewReader([]byte{252, 255, 255, 255, 255, 255, 255, 255})
	var a int64
	binary.Read(buf, binary.LittleEndian, &a)
	fmt.Println(a + 1)
	buf = bytes.NewReader([]byte{252, 255, 255, 255, 255, 255, 255, 255})
	var u uint64
	binary.Read(buf, binary.LittleEndian, &u)
	fmt.Println(u + 1)
	fmt.Println(binary.Size(Point{}))
}
`,
		`-3
18446744073709551613
8
`,
	);
});
