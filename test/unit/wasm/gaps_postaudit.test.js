// test/unit/wasm/gaps_postaudit.test.js
import { assertEqual, compileHybrid, section, test } from "../helpers.js";

section("Post-audit 3.B — math & math/bits");

test("math bits reinterpretations and hyperbolics", () => {
	const src = `
package main

import (
	"fmt"
	"math"
)

func Main() string {
	b64 := math.Float64bits(1.0)
	f64 := math.Float64frombits(b64)
	b32 := math.Float32bits(1.0)
	f32 := math.Float32frombits(b32)

	sinh0 := math.Sinh(0)
	cosh0 := math.Cosh(0)
	tanh0 := math.Tanh(0)

	return fmt.Sprintf("%x|%v|%x|%v|%v|%v|%v", b64, f64, b32, f32, sinh0, cosh0, tanh0)
}
`;
	const { wasmRes, jsRes } = compileHybrid(src).run("Main");
	assertEqual(wasmRes, jsRes);
	assertEqual(wasmRes, "3ff0000000000000|1|3f800000|1|0|1|0");
});

test("math/bits functions", () => {
	const src = `
package main

import (
	"fmt"
	"math/bits"
)

func Main() string {
	l32 := bits.Len32(0x10)
	l64 := bits.Len64(0x100000000)
	rb16 := bits.ReverseBytes16(0x1234)
	rb32 := bits.ReverseBytes32(0x12345678)
	rb64 := bits.ReverseBytes64(0x0000112233445566)
	r32 := bits.Reverse32(0x80000001)
	r64 := bits.Reverse64(0x0000000100000002)

	return fmt.Sprintf("%d|%d|%x|%x|%x|%x|%x", l32, l64, rb16, rb32, rb64, r32, r64)
}
`;
	const { wasmRes, jsRes } = compileHybrid(src).run("Main");
	assertEqual(wasmRes, jsRes);
	assertEqual(
		wasmRes,
		"5|33|3412|78563412|6655443322110000|80000001|4000000080000000",
	);
});

section("Post-audit 3.B — errors & strconv");

test("errors.Join and errors.As", () => {
	const src = `
package main

import (
	"errors"
	"fmt"
)

type MyErr struct {
	Msg string
}

func (e *MyErr) Error() string {
	return e.Msg
}

func Main() string {
	e1 := errors.New("e1")
	e2 := errors.New("e2")
	joined := errors.Join(e1, e2)
	joinedNil := errors.Join(nil, nil)

	custom := &MyErr{Msg: "custom err"}
	wrapped := fmt.Errorf("wrapped: %w", custom)
	var target *MyErr
	matched := errors.As(wrapped, &target)

	return fmt.Sprintf("%v|%v|%v|%v", joined != nil, joinedNil == nil, matched, target != nil && target.Msg == "custom err")
}
`;
	const { wasmRes, jsRes } = compileHybrid(src).run("Main");
	assertEqual(wasmRes, jsRes);
	assertEqual(wasmRes, "true|true|true|true");
});

test("strconv Uint functions and AppendBool", () => {
	const src = `
package main

import (
	"fmt"
	"strconv"
)

func Main() string {
	s := strconv.FormatUint(12345, 10)
	u, err := strconv.ParseUint("12345", 10, 64)
	if err != nil {
		return "err: " + err.Error()
	}

	dst := []byte("val: ")
	dst = strconv.AppendUint(dst, u, 10)
	dst = append(dst, ' ')
	dst = strconv.AppendBool(dst, true)

	return fmt.Sprintf("%s|%d|%s", s, u, string(dst))
}
`;
	const { wasmRes, jsRes } = compileHybrid(src).run("Main");
	assertEqual(wasmRes, jsRes);
	assertEqual(wasmRes, "12345|12345|val: 12345 true");
});

section("Post-audit 3.B — slices, strings, bytes, io");

test("slices IndexFunc, ContainsFunc, BinarySearch, BinarySearchFunc", () => {
	const src = `
package main

import (
	"fmt"
	"slices"
)

func Main() string {
	nums := []int{10, 20, 30, 40, 50}

	idx := slices.IndexFunc(nums, func(x int) bool { return x == 30 })
	has := slices.ContainsFunc(nums, func(x int) bool { return x == 99 })

	pos, found := slices.BinarySearch(nums, 30)
	posFunc, foundFunc := slices.BinarySearchFunc(nums, 40, func(a, b int) int {
		return a - b
	})

	return fmt.Sprintf("%d|%v|%d|%v|%d|%v", idx, has, pos, found, posFunc, foundFunc)
}
`;
	const { wasmRes, jsRes } = compileHybrid(src).run("Main");
	assertEqual(wasmRes, jsRes);
	assertEqual(wasmRes, "2|false|2|true|3|true");
});

test("strings.FieldsFunc and bytes.FieldsFunc and bytes.Clone", () => {
	const src = `
package main

import (
	"bytes"
	"fmt"
	"strings"
)

func Main() string {
	sParts := strings.FieldsFunc("foo,bar;baz", func(r rune) bool {
		return r == ',' || r == ';'
	})

	bParts := bytes.FieldsFunc([]byte("hello,world;wasm"), func(r rune) bool {
		return r == ',' || r == ';'
	})

	orig := []byte("clone me")
	cloned := bytes.Clone(orig)
	cloned[0] = 'C'

	return fmt.Sprintf("%s|%s|%s|%s", strings.Join(sParts, "-"), string(bytes.Join(bParts, []byte("-"))), string(orig), string(cloned))
}
`;
	const { wasmRes, jsRes } = compileHybrid(src).run("Main");
	assertEqual(wasmRes, jsRes);
	assertEqual(wasmRes, "foo-bar-baz|hello-world-wasm|clone me|Clone me");
});

test("io.LimitReader, io.Copy, io.CopyN", () => {
	const src = `
package main

import (
	"bytes"
	"fmt"
	"io"
	"strings"
)

func Main() string {
	src := strings.NewReader("hello world from gofront")
	var dst bytes.Buffer

	// Copy 5 bytes using LimitReader
	lr := io.LimitReader(src, 5)
	n1, err1 := io.Copy(&dst, lr)

	// Copy next 6 bytes using CopyN
	var dst2 bytes.Buffer
	n2, err2 := io.CopyN(&dst2, src, 6)

	// Copy remaining
	var dst3 bytes.Buffer
	n3, err3 := io.Copy(&dst3, src)

	return fmt.Sprintf("%d:%v:%s|%d:%v:%s|%d:%v:%s",
		n1, err1 == nil, dst.String(),
		n2, err2 == nil, dst2.String(),
		n3, err3 == nil, dst3.String(),
	)
}
`;
	const { wasmRes, jsRes } = compileHybrid(src).run("Main");
	assertEqual(wasmRes, jsRes);
	assertEqual(wasmRes, "5:true:hello|6:true: world|13:true: from gofront");
});

section("Post-audit 3.C — sync");

test("sync.Mutex, sync.RWMutex, sync.Once, sync.WaitGroup", () => {
	const src = `
package main

import (
	"fmt"
	"sync"
)

func Main() string {
	var mu sync.Mutex
	mu.Lock()
	tl := mu.TryLock()
	mu.Unlock()

	var rw sync.RWMutex
	rw.RLock()
	rw.RUnlock()
	rw.Lock()
	rw.Unlock()

	var once sync.Once
	count := 0
	f := func() {
		count++
	}
	once.Do(f)
	once.Do(f)

	var wg sync.WaitGroup
	wg.Add(2)
	wg.Done()
	wg.Done()
	wg.Wait()

	return fmt.Sprintf("%v|%d", tl, count)
}
`;
	const { wasmRes, jsRes } = compileHybrid(src).run("Main");
	assertEqual(wasmRes, jsRes);
	assertEqual(wasmRes, "true|1");
});

section("Post-audit 3.C — crypto/rand & crypto/sha256");

test("crypto/rand.Read and crypto/sha256.Sum256", () => {
	const src = `
package main

import (
	"crypto/rand"
	"crypto/sha256"
	"fmt"
)

func Main() string {
	b := make([]byte, 16)
	n, err := rand.Read(b)

	h := sha256.Sum256([]byte("hello world"))
	sz := sha256.Size
	bsz := sha256.BlockSize

	return fmt.Sprintf("%d:%v:%d|%x|%d:%d", n, err == nil, len(b), h, sz, bsz)
}
`;
	const { wasmRes, jsRes } = compileHybrid(src).run("Main");
	assertEqual(wasmRes, jsRes);
	assertEqual(
		wasmRes,
		"16:true:16|b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9|32:64",
	);
});

section("Post-audit 3.C — encoding/binary");

test("encoding/binary LittleEndian, BigEndian, Append, Size, Read, Write", () => {
	const src = `
package main

import (
	"bytes"
	"encoding/binary"
	"fmt"
)

func Main() string {
	b := make([]byte, 8)
	binary.LittleEndian.PutUint16(b, 0x1234)
	u16 := binary.LittleEndian.Uint16(b)

	binary.LittleEndian.PutUint32(b, 0x12345678)
	u32 := binary.LittleEndian.Uint32(b)

	binary.LittleEndian.PutUint64(b, 0x123456789abc)
	u64 := binary.LittleEndian.Uint64(b)

	binary.BigEndian.PutUint16(b, 0x1234)
	be16 := binary.BigEndian.Uint16(b)

	binary.BigEndian.PutUint32(b, 0x12345678)
	be32 := binary.BigEndian.Uint32(b)

	binary.BigEndian.PutUint64(b, 0x123456789abc)
	be64 := binary.BigEndian.Uint64(b)

	var app []byte
	app = binary.LittleEndian.AppendUint16(app, 0x1234)
	app = binary.LittleEndian.AppendUint32(app, 0x56789abc)

	sz1 := binary.Size(uint32(0))
	sz2 := binary.Size(uint64(0))

	var readVal uint32
	buf := bytes.NewReader([]byte{0x78, 0x56, 0x34, 0x12})
	errRead := binary.Read(buf, binary.LittleEndian, &readVal)

	var writeBuf bytes.Buffer
	errWrite := binary.Write(&writeBuf, binary.LittleEndian, uint32(0x12345678))

	return fmt.Sprintf("%x:%x:%x|%x:%x:%x|%x|%d:%d|%x:%v|%x:%v",
		u16, u32, u64,
		be16, be32, be64,
		app,
		sz1, sz2,
		readVal, errRead == nil,
		writeBuf.Bytes(), errWrite == nil,
	)
}
`;
	const { wasmRes, jsRes } = compileHybrid(src).run("Main");
	assertEqual(wasmRes, jsRes);
	assertEqual(
		wasmRes,
		"1234:12345678:123456789abc|1234:12345678:123456789abc|3412bc9a7856|4:8|12345678:true|78563412:true",
	);
});

section("Post-audit 3.C — encoding/hex & encoding/base64");

test("encoding/hex EncodeToString, DecodeString, EncodedLen, DecodedLen", () => {
	const src = `
package main

import (
	"encoding/hex"
	"fmt"
)

func Main() string {
	src := []byte("hello world")
	enc := hex.EncodeToString(src)

	dec, err := hex.DecodeString(enc)

	_, badErr := hex.DecodeString("invalid-hex!")

	el := hex.EncodedLen(len(src))
	dl := hex.DecodedLen(len(enc))

	return fmt.Sprintf("%s|%s:%v|%v|%d:%d", enc, string(dec), err == nil, badErr != nil, el, dl)
}
`;
	const { wasmRes, jsRes } = compileHybrid(src).run("Main");
	assertEqual(wasmRes, jsRes);
	assertEqual(wasmRes, "68656c6c6f20776f726c64|hello world:true|true|22:11");
});

test("encoding/base64 StdEncoding, URLEncoding, RawStdEncoding, RawURLEncoding", () => {
	const src = `
package main

import (
	"encoding/base64"
	"fmt"
)

func Main() string {
	data := []byte("hello?world>>123")

	std := base64.StdEncoding.EncodeToString(data)
	decStd, errStd := base64.StdEncoding.DecodeString(std)

	url := base64.URLEncoding.EncodeToString(data)
	decUrl, errUrl := base64.URLEncoding.DecodeString(url)

	rawStd := base64.RawStdEncoding.EncodeToString(data)
	rawUrl := base64.RawURLEncoding.EncodeToString(data)

	el := base64.StdEncoding.EncodedLen(len(data))
	dl := base64.StdEncoding.DecodedLen(len(std))

	return fmt.Sprintf("%s|%s:%v|%s|%s:%v|%s|%s|%d:%d",
		std, string(decStd), errStd == nil,
		url, string(decUrl), errUrl == nil,
		rawStd, rawUrl,
		el, dl,
	)
}
`;
	const { wasmRes, jsRes } = compileHybrid(src).run("Main");
	assertEqual(wasmRes, jsRes);
});

section("Post-audit 4 — WASM optimization & codegen improvements");

test("Section 4 optimizations: constant folding, constant divisors, constant array indexing, index-only range", () => {
	const src = `
package main

import (
	"bytes"
	"fmt"
	"io"
	"strings"
)

type Point struct {
	X int
	Y int
}

func makePoint(x, y int) Point {
	return Point{X: x, Y: y}
}

func Main() string {
	// Function-body constant folding
	foldedInt := 24 * 60 * 60
	foldedShift := 1 << 8

	// Constant divisors (signed and unsigned powers-of-two and general)
	u := uint32(100)
	uDiv := u / 16
	uRem := u % 16
	s := int32(-105)
	sDiv := s / 10
	sRem := s % 10

	// Constant-indexed fixed-size array
	var coords [4]int
	coords[0] = 10
	coords[1] = 20
	coords[2] = 30
	coords[3] = 40
	c0 := coords[0]
	c2 := coords[2]

	// CallExpr struct return (skip copy)
	pt := makePoint(c0, c2)

	// Direct WriteString on Builder and Buffer via io.WriteString & fmt.Fprintf
	var sb strings.Builder
	io.WriteString(&sb, "hello-")
	fmt.Fprintf(&sb, "%d", pt.X)

	var buf bytes.Buffer
	io.WriteString(&buf, "world-")
	fmt.Fprintf(&buf, "%d", pt.Y)

	// Index-only slice range loop
	slice := []int{100, 200, 300, 400}
	sumIdx := 0
	for i := range slice {
		sumIdx += i
	}

	return fmt.Sprintf("%d:%d|%d:%d:%d:%d|%d:%d|%d:%d|%s|%s|%d",
		foldedInt, foldedShift,
		uDiv, uRem, sDiv, sRem,
		c0, c2,
		pt.X, pt.Y,
		sb.String(), buf.String(),
		sumIdx,
	)
}
`;
	const { wasmRes, jsRes } = compileHybrid(src).run("Main");
	assertEqual(wasmRes, jsRes);
	assertEqual(wasmRes, "86400:256|6:4:-10:-5|10:30|10:30|hello-10|world-30|6");
});
