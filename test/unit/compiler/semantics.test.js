// GoFront test suite — Go Semantics & Edge Cases
// Tests Go semantic invariants, interface boxing, value semantics, and stdlib behavior across JS and WASM.

import { fileURLToPath } from "node:url";
import { optimizeWasm } from "../../../src/backend/wasm/optimize.js";
import {
	assert,
	assertEqual,
	assertValidWasm,
	compile,
	compileWasm,
	runJs,
	runWasm,
	section,
	summarize,
	test,
} from "../helpers.js";

section("Go Semantics & Edge Cases");

// Generic struct type arguments preserved by resolveType()
test("Generic struct type argument preservation and value semantics", () => {
	// Type checking: Box[string] assigned to Box[int] must fail
	const typeErrCode = `package main
type Box[T any] struct { Val T }
func main() {
	var a Box[int] = Box[string]{Val: "bad"}
	_ = a
}`;
	const { errors: errs1 } = compile(typeErrCode);
	assert(
		errs1.length > 0,
		"expected type error assigning Box[string] to Box[int]",
	);

	// Codegen: struct field inside generic retains struct type for cloning
	const cloneCode = `package main
type Point struct { X, Y int }
type Box[T any] struct { Val T }
func main() {
	b := Box[Point]{Val: Point{X: 41, Y: 99}}
	p := b.Val
	p.X = 99
	console.log(b.Val.X, p.X)
}`;
	const { js, errors } = compile(cloneCode);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "41 99");
});

// Interface boxing nil preservation and array value semantics
test("Interface boxing nil slice/map, array semantics, recursive ptrFields", () => {
	const code = `package main
import (
	"fmt"
	"slices"
)
type A struct { Val int }
type B struct { X A }
type Outer struct {
	P *int
	Child B
}
func main() {
	var s []int = nil
	s2 := slices.Clone(s)
	fmt.Println(s2 == nil)

	arr := [3]int{1, 2, 3}
	var a any = arr
	arr[0] = 99
	fmt.Println(a)

	x := 42
	o := Outer{P: &x, Child: B{X: A{Val: 99}}}
	_ = fmt.Sprintf("%v", o)
	b := o.Child
	fmt.Println(b)
}`;
	const { js, errors } = compile(code);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "true\n[1 2 3]\n{{99}}");
});

// []byte representation mismatch (Uint8Array)
test("[]byte representation and slicing", () => {
	const code = `package main
import (
	"bytes"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"strconv"
)
func main() {
	sum := sha256.Sum256([]byte("hello"))
	s1 := sum[1:4]
	console.log(len(s1))

	h, _ := hex.DecodeString("deadbeef")
	s2 := h[1:3]
	console.log(len(s2))

	b64, _ := base64.StdEncoding.DecodeString("aGVsbG8=")
	s3 := b64[0:2]
	console.log(len(s3))

	appended := strconv.AppendInt([]byte("val="), 42, 10)
	s4 := appended[4:]
	console.log(string(s4))

	var buf bytes.Buffer
	buf.WriteString("buffer-content")
	s5 := buf.Bytes()[0:6]
	console.log(string(s5))
}`;
	const { js, errors } = compile(code);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "3\n2\n2\n42\nbuffer");
});

// BigInt vs Number for uint64 in JS stdlib
test("uint64 Number arithmetic and type assertion", () => {
	const code = `package main
import (
	"fmt"
	"math"
	"math/bits"
	"strconv"
)
func main() {
	u1, _ := strconv.ParseUint("1234567890", 10, 64)
	fmt.Println(u1 + 1)

	u2 := math.Float64bits(1.0)
	var x any = u2
	_, ok := x.(uint64)
	fmt.Println(ok)

	rot := bits.RotateLeft64(1, 2)
	fmt.Println(rot)
}`;
	const { js, errors } = compile(code);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "1234567891\ntrue\n4");
});

// Missing helper dependencies in useHelper
test("Registered helpers on error paths", () => {
	const code = `package main
import (
	"encoding/base64"
	"encoding/hex"
)
func main() {
	_, err1 := base64.StdEncoding.DecodeString("invalid!base64")
	console.log(err1 != nil)
	_, err2 := hex.DecodeString("not-hex")
	console.log(err2 != nil)
}`;
	const { js, errors } = compile(code);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "true\ntrue");
});

// errors.As on interface targets & errors.Is on errors.Join
test("errors.As interface target and errors.Join traversal", () => {
	const code = `package main
import (
	"errors"
	"fmt"
)
type customErr struct{ msg string }
func (e *customErr) Error() string { return e.msg }

func main() {
	e1 := &customErr{msg: "err1"}
	e2 := errors.New("err2")
	joined := errors.Join(e1, e2)
	console.log(errors.Is(joined, e1))
	console.log(errors.Is(joined, e2))

	var target error
	ok := errors.As(e1, &target)
	console.log(ok, target.Error())
}`;
	const { js, errors } = compile(code);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "true\ntrue\ntrue err1");
});

// binary.Read / binary.Write across JS and WASM
test("binary.Read / binary.Write across JS and WASM", async () => {
	const code = `package main
import (
	"bytes"
	"encoding/binary"
	"fmt"
	"io"
)
type S struct {
	F float32
	I int16
}
func readU32(r io.Reader, p *uint32) {
	_ = binary.Read(r, binary.LittleEndian, p)
}
func main() {
	var buf bytes.Buffer
	s := S{F: 3.25, I: -2}
	_ = binary.Write(&buf, binary.LittleEndian, s.F)
	_ = binary.Write(&buf, binary.LittleEndian, s.I)

	var s2 S
	_ = binary.Read(&buf, binary.LittleEndian, &s2.F)
	_ = binary.Read(&buf, binary.LittleEndian, &s2.I)
	fmt.Printf("%.2f %d\\n", s2.F, s2.I)

	var buf2 bytes.Buffer
	_ = binary.Write(&buf2, binary.LittleEndian, uint32(0x12345678))
	var u uint32
	readU32(&buf2, &u)
	fmt.Printf("%x\\n", u)
}`;
	const { js, errors } = compile(code);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js).replace(/\n+/g, "\n").trim(), "3.25 -2\n12345678");

	const compiled = compileWasm(code);
	assertValidWasm(compiled.wasm);
	const wasmRes = runWasm(compiled.wasm, { stringTable: compiled.stringTable });
	wasmRes.exports.main();
	assertEqual(
		wasmRes.lines.join("\n").replace(/\n+/g, "\n").trim(),
		"3.25 -2\n12345678",
	);
});

// WASM stdlib calls (sha256.New, binary.BigEndian, time.Local)
test("WASM stdlib calls", () => {
	const code = `package main
import (
	"crypto/sha256"
	"encoding/binary"
	"fmt"
	"time"
)
func main() {
	h := sha256.New()
	h.Write([]byte("abc"))
	sum := h.Sum(nil)
	fmt.Printf("%x\\n", sum[0:4])

	order := binary.BigEndian
	b := []byte{0x12, 0x34}
	fmt.Println(order.Uint16(b))

	t := time.Unix(1000, 0).Local()
	fmt.Println(t.Unix())
}`;
	const compiled = compileWasm(code);
	assertValidWasm(compiled.wasm);
	const wasmRes = runWasm(compiled.wasm, { stringTable: compiled.stringTable });
	wasmRes.exports.main();
	assertEqual(wasmRes.lines.join("\n"), "ba7816bf\n4660\n1000");
});

// optimizeWasm nil pointer dereference traps
test("optimizeWasm retains traps on nil struct dereference", async () => {
	const code = `//gofront:target wasm
package main
type Node struct { val int }
func deref(n *Node) int {
	return n.val
}
func main() {
	deref(nil)
}`;
	const compiled = compileWasm(code);
	assertValidWasm(compiled.wasm);
	const opt = await optimizeWasm(compiled.wasm, { level: 2 });
	assertValidWasm(opt.wasm);

	const wasmRes = runWasm(opt.wasm, { stringTable: compiled.stringTable });
	let trapped = false;
	try {
		wasmRes.exports.main();
	} catch (_e) {
		trapped = true;
	}
	assert(trapped, "expected nil dereference trap in optimized WASM module");
});

// WASM compound assignments on *p, s.f, a[i]
test("WASM compound assignments /=, %=, <<=, >>= on targets", () => {
	const code = `package main
import "fmt"
type S struct { x int }
func update(p *int) {
	*p /= 2
	*p %= 7
	*p <<= 2
	*p >>= 1
}
func main() {
	v := 20
	update(&v)
	s := S{x: 40}
	s.x /= 4
	arr := [2]int{100, 200}
	arr[1] %= 30
	fmt.Printf("%d %d %d\\n", v, s.x, arr[1])
}`;
	const compiled = compileWasm(code);
	assertValidWasm(compiled.wasm);
	const wasmRes = runWasm(compiled.wasm, { stringTable: compiled.stringTable });
	wasmRes.exports.main();
	assertEqual(wasmRes.lines.join("\n"), "6 10 20");
});

// Qualified named type conversions check arity and type
test("Qualified named type conversions checked by typechecker", () => {
	const noArgCode = `package main
import "time"
func main() { _ = time.Duration() }`;
	const { errors: errs1 } = compile(noArgCode);
	assert(errs1.length > 0, "expected arity error on time.Duration()");

	const badConvCode = `package main
import "sync"
func main() { _ = sync.Mutex(123) }`;
	const { errors: errs2 } = compile(badConvCode);
	assert(errs2.length > 0, "expected convertibility error on sync.Mutex(123)");
});

// time.Time == and fmt.Sprintf in JS
test("time.Time equality and fmt.Sprintf formatting", () => {
	const code = `package main
import (
	"fmt"
	"strings"
	"time"
)
func main() {
	t1 := time.Unix(100, 0)
	t2 := time.Unix(100, 0)
	t3 := time.Unix(200, 0)
	console.log(t1 == t2, t1 == t3)
	str := fmt.Sprintf("%v", t1)
	console.log(strings.Contains(str, "1970"))
}`;
	const { js, errors } = compile(code);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "true false\ntrue");
});

// crypto/rand.Read > 64KB
test("crypto/rand.Read with buffers exceeding 64KB", () => {
	const code = `package main
import "crypto/rand"
func main() {
	buf := make([]byte, 70000)
	n, err := rand.Read(buf)
	println(n, err == nil)
}`;
	const { js, errors } = compile(code);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "70000 true");

	const compiled = compileWasm(code);
	assertValidWasm(compiled.wasm);
	const wasmRes = runWasm(compiled.wasm, { stringTable: compiled.stringTable });
	wasmRes.exports.main();
	assertEqual(wasmRes.lines.join("\n"), "70000 true");
});

// Multi-return forwarding into any parameter
test("Multi-return forwarding into any parameter", () => {
	const code = `package main
import "fmt"
type Point struct{ X, Y int }
func getPair() (Point, int) {
	return Point{X: 10, Y: 20}, 42
}
func takeTwo(a any, b int) {
	fmt.Println(a, b)
}
func main() {
	takeTwo(getPair())
}`;
	const { js, errors } = compile(code);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "{10 20} 42");
});

// WASM fmt.Sscan* into struct field, slice index, pointer parameter
test("WASM fmt.Sscan* target writes", () => {
	const code = `package main
import "fmt"
type S struct{ x int }
func scanToPtr(p *int) {
	fmt.Sscan("77", p)
}
func main() {
	s := S{x: 0}
	fmt.Sscan("15", &s.x)
	arr := []int{0, 0}
	fmt.Sscan("25", &arr[1])
	v := 0
	scanToPtr(&v)
	fmt.Printf("%d %d %d\\n", s.x, arr[1], v)
}`;
	const compiled = compileWasm(code);
	assertValidWasm(compiled.wasm);
	const wasmRes = runWasm(compiled.wasm, { stringTable: compiled.stringTable });
	wasmRes.exports.main();
	assertEqual(wasmRes.lines.join("\n"), "15 25 77");
});

// JS fmt.Sscanf format verbs (%x, %X, %o, %b, %c)
test("JS fmt.Sscanf numeric and rune verbs", () => {
	const code = `package main
import "fmt"
func main() {
	var a, b, c, d int
	var r rune
	fmt.Sscanf("ff", "%x", &a)
	fmt.Sscanf("FF", "%X", &b)
	fmt.Sscanf("77", "%o", &c)
	fmt.Sscanf("1010", "%b", &d)
	fmt.Sscanf("Z", "%c", &r)
	console.log(a, b, c, d, string(r))
}`;
	const { js, errors } = compile(code);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "255 255 63 10 Z");
});

// Time formatting subseconds in JS and WASM
test("Time formatting subsecond precision", () => {
	const code = `package main
import (
	"fmt"
	"time"
)
func main() {
	t := time.Unix(0, 123000000)
	fmt.Println(t.Format(".000"), t.Format(".000000"))
}`;
	const { js, errors } = compile(code);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), ".123 .123000");

	const compiled = compileWasm(code);
	assertValidWasm(compiled.wasm);
	const wasmRes = runWasm(compiled.wasm, { stringTable: compiled.stringTable });
	wasmRes.exports.main();
	assertEqual(wasmRes.lines.join("\n"), ".123 .123000");
});

// Strings, bytes, path.Match, base64 edge cases
test("Strings, bytes, path.Match, base64 edge cases", () => {
	const code = `package main
import (
	"bytes"
	"encoding/base64"
	"path"
	"strings"
)
func main() {
	m1, _ := path.Match("[^a]", "b")
	m2, _ := path.Match("[.-0]", "/")
	_, err := path.Match("[]", "")
	console.log(m1, m2, err != nil)

	s := strings.Trim("[hello]", "[]")
	console.log(s)

	b := bytes.Split([]byte("abc"), []byte(""))
	console.log(len(b), string(b[0]), string(b[1]), string(b[2]))

	r := bytes.Replace([]byte("abc"), []byte(""), []byte("x"), 2)
	console.log(string(r))

	encLen := base64.RawStdEncoding.EncodedLen(1)
	console.log(encLen)
}`;
	const { js, errors } = compile(code);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "true false true\nhello\n3 a b c\nxaxbc\n2");

	const wasmCode = `package main
import (
	"bytes"
	"encoding/base64"
	"fmt"
)
func main() {
	b := bytes.Split([]byte("abc"), []byte(""))
	fmt.Printf("%d %s %s %s\\n", len(b), string(b[0]), string(b[1]), string(b[2]))
	r := bytes.Replace([]byte("abc"), []byte(""), []byte("x"), 2)
	fmt.Println(string(r))
	fmt.Println(base64.RawStdEncoding.EncodedLen(1))
}`;
	const compiled = compileWasm(wasmCode);
	assertValidWasm(compiled.wasm);
	const wasmRes = runWasm(compiled.wasm, { stringTable: compiled.stringTable });
	wasmRes.exports.main();
	assertEqual(wasmRes.lines.join("\n"), "3 a b c\nxaxbc\n2");
});

// Typechecker signatures (sha256.Sum256 length, time.Unix, bytes.Buffer.Read)
test("Typechecker signatures and stdlib interfaces", () => {
	const sumCode = `package main
import "crypto/sha256"
func main() {
	var bad [4]byte = sha256.Sum256([]byte("x"))
	_ = bad
}`;
	const { errors: errs1 } = compile(sumCode);
	assert(
		errs1.length > 0,
		"expected type error on [4]byte = sha256.Sum256(...)",
	);

	const unixCode = `package main
import "time"
func main() {
	t := time.Now()
	_ = time.Unix(t.Unix(), 0)
}`;
	const { errors: errs2 } = compile(unixCode);
	assertEqual(errs2.length, 0);

	const bufCode = `package main
import (
	"bytes"
	"io"
)
func main() {
	var buf bytes.Buffer
	_, _ = io.ReadAll(&buf)
}`;
	const { errors: errs3 } = compile(bufCode);
	assertEqual(errs3.length, 0);
});

// Legacy octal literal 0755
test("Legacy octal literal parsing in WASM and constant folder", () => {
	const code = `package main
import "fmt"
const perm = 0755
func main() {
	x := 0755
	fmt.Println(perm, x)
}`;
	const { js, errors } = compile(code);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "493 493");

	const compiled = compileWasm(code);
	assertValidWasm(compiled.wasm);
	const wasmRes = runWasm(compiled.wasm, { stringTable: compiled.stringTable });
	wasmRes.exports.main();
	assertEqual(wasmRes.lines.join("\n"), "493 493");
});

// JS stdlib inline templates double evaluation
test("JS stdlib inline templates evaluate arguments once", () => {
	const code = `package main
import "strings"
var count = 0
func getStr() string {
	count++
	return "  hello  "
}
func main() {
	_ = strings.TrimSpace(getStr())
	console.log(count)
}`;
	const { js, errors } = compile(code);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "1");
});

// Minor stdlib discrepancies (sync.RWMutex, strings.Builder UTF-8 length)
test("sync.RWMutex and strings.Builder byte count parity", () => {
	const code = `package main
import (
	"strings"
	"sync"
)
func main() {
	var mu sync.RWMutex
	mu.RLock()
	mu.RUnlock()
	console.log(mu.TryRLock())
	mu.RUnlock()

	var b strings.Builder
	b.WriteString("世界")
	console.log(b.Len())
}`;
	const { js, errors } = compile(code);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "true\n6");

	const wasmCode = `package main
import (
	"fmt"
	"strings"
)
func main() {
	var b strings.Builder
	b.WriteString("世界")
	fmt.Println(b.Len())
}`;
	const compiled = compileWasm(wasmCode);
	assertValidWasm(compiled.wasm);
	const wasmRes = runWasm(compiled.wasm, { stringTable: compiled.stringTable });
	wasmRes.exports.main();
	assertEqual(wasmRes.lines.join("\n"), "6");
});

test("math/bits 64-bit functions return Number values for arithmetic", () => {
	const code = `package main
import (
	"fmt"
	"math/bits"
)
func main() {
	r := bits.RotateLeft64(1, 1)
	fmt.Println(r + 1)
	s, c := bits.Add64(1, 2, 0)
	fmt.Println(s + 1, c + 1)
	diff, b := bits.Sub64(5, 3, 0)
	fmt.Println(diff + 1, b + 1)
	hi, lo := bits.Mul64(2, 3)
	fmt.Println(hi + 1, lo + 1)
	q, rem := bits.Div64(0, 10, 2)
	fmt.Println(q + 1, rem + 1)
	rm := bits.Rem64(0, 10, 3)
	fmt.Println(rm + 1)
	rev := bits.Reverse64(1)
	fmt.Println(rev == 0x8000000000000000)
	revb := bits.ReverseBytes64(0x0102030405060708)
	fmt.Println(revb == 0x0807060504030201)
}`;
	const { js, errors } = compile(code);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "3\n4 1\n3 1\n1 7\n6 1\n2\ntrue\ntrue");
});

test("time.ParseDuration returns Number duration compatible with arithmetic", () => {
	const code = `package main
import (
	"fmt"
	"time"
)
func main() {
	d, _ := time.ParseDuration("5s")
	fmt.Println(d + time.Second)
	fmt.Println(d == 5*time.Second)
}`;
	const { js, errors } = compile(code);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "6s\ntrue");
});

test("time.FixedZone calendar components and RFC3339 formatting", () => {
	const code = `package main
import (
	"fmt"
	"time"
)
func main() {
	loc := time.FixedZone("EST", -5*3600)
	t := time.Date(2026, 4, 15, 12, 0, 0, 0, loc)
	fmt.Println(t.Hour())
	fmt.Println(t.Year(), int(t.Month()), t.Day(), t.Minute(), t.Second())
	fmt.Println(t.Format(time.RFC3339))
}`;
	const { js, errors } = compile(code);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "12\n2026 4 15 0 0\n2026-04-15T12:00:00-05:00");
});

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	process.exit((await summarize()) > 0 ? 1 : 0);
}
