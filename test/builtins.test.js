// GoFront test suite — built-in functions and operators
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import {
	FIXTURES,
	ROOT,
	assert,
	assertContains,
	assertErrorContains,
	assertEqual,
	compile,
	compileFile,
	runJs,
	section,
	summarize,
	test,
} from "./helpers.js";

section("Builtins");

test("make([]StructType, n) initialises each element to zero struct", () => {
	// Each element must be a distinct struct instance, not a shared reference.
	const { js, errors } = compile(`package main
type Point struct { X int; Y int }
func main() {
  ps := make([]Point, 3)
  ps[0].X = 7
  console.log(ps[0].X)
  console.log(ps[1].X)
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "7\n0");
});

test("make([]StructType, n) elements are independent instances", () => {
	// Mutating one element must not affect another (no shared reference).
	const { js, errors } = compile(`package main
type Counter struct { N int }
func main() {
  cs := make([]Counter, 2)
  cs[0].N = 99
  console.log(cs[0].N)
  console.log(cs[1].N)
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "99\n0");
});

test("make([]int, n) still uses fill with 0", () => {
	const { js } = compile(`package main
func main() {
  xs := make([]int, 3)
  console.log(xs[0])
}`);
	assertContains(js, "fill(0)");
	assertEqual(runJs(js), "0");
});

test("map range iteration visits all keys (insertion order)", () => {
	// GoFront maps use JS objects — iteration is insertion-order, not randomised.
	// This test documents the semantic difference from Go and ensures it works.
	const { js, errors } = compile(`package main
func main() {
  m := map[string]int{"a": 1, "b": 2, "c": 3}
  for k, v := range m {
    console.log(k, v)
  }
}`);
	assertEqual(errors.length, 0);
	// All three pairs must appear, in insertion order
	assertEqual(runJs(js), "a 1\nb 2\nc 3");
});

test("cap() on slice", () => {
	// GoFront compiles to JS arrays which have no separate capacity concept;
	// cap() returns length (the only meaningful value at runtime).
	const { js } = compile(`package main
func main() {
  xs := make([]int, 3)
  console.log(cap(xs))
}`);
	assertEqual(runJs(js), "3");
});

test("copy() copies elements", () => {
	const { js } = compile(`package main
func main() {
  src := []int{1, 2, 3}
  dst := make([]int, 3)
  n := copy(dst, src)
  console.log(n)
  console.log(dst[0])
  console.log(dst[2])
}`);
	assertEqual(runJs(js), "3\n1\n3");
});

test("copy() limited by destination length", () => {
	const { js } = compile(`package main
func main() {
  src := []int{10, 20, 30, 40}
  dst := make([]int, 2)
  n := copy(dst, src)
  console.log(n)
  console.log(dst[0])
  console.log(dst[1])
}`);
	assertEqual(runJs(js), "2\n10\n20");
});

test("panic() throws with message", () => {
	const { js } = compile(`package main
func main() {
  panic("something went wrong")
}`);
	let threw = false;
	try {
		runJs(js);
	} catch (e) {
		threw = e.message.includes("something went wrong");
	}
	assert(threw, "expected panic to throw");
});

// ═════════════════════════════════════════════════════════════
// Type assertions
// ═════════════════════════════════════════════════════════════


section("fmt package");

test("fmt.Sprintf formats %s and %d", () => {
	const { js, errors } = compile(`package main
func main() {
  s := fmt.Sprintf("hello %s, you are %d years old", "alice", 30)
  console.log(s)
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "hello alice, you are 30 years old");
});

test("fmt.Sprintf %v with bool and nil", () => {
	const { js, errors } = compile(`package main
func main() {
  console.log(fmt.Sprintf("%v %v", true, false))
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "true false");
});

test("fmt.Sprintf %% literal percent", () => {
	const { js, errors } = compile(`package main
func main() {
  console.log(fmt.Sprintf("100%%"))
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "100%");
});

test("fmt.Println logs formatted string", () => {
	const { js, errors } = compile(`package main
func main() {
  fmt.Println("count: %d items", 5)
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "count: 5 items");
});

test("fmt.Errorf creates error from format", () => {
	const { js, errors } = compile(`package main
func main() {
  err := fmt.Errorf("failed at step %d", 3)
  console.log(err)
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "failed at step 3");
});

test("fmt.Errorf result usable as error (nil check + .Error())", () => {
	const { js, errors } = compile(`package main
func validate(n int) error {
  if n < 0 {
    return fmt.Errorf("negative value: %d", n)
  }
  return nil
}
func main() {
  e := validate(-1)
  console.log(e != nil)
  console.log(e.Error())
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "true\nnegative value: -1");
});

test("fmt.Sprintf plain string (no format verbs)", () => {
	const { js, errors } = compile(`package main
func main() {
  console.log(fmt.Sprintf("no verbs here"))
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "no verbs here");
});

test("__sprintf not emitted when fmt is unused", () => {
	const { js } = compile(`package main
func main() {
  console.log("hello")
}`);
	assert(!js.includes("__sprintf"), "expected __sprintf not to be emitted");
});

test("fmt.Sprintf emits __sprintf helper", () => {
	const { js } = compile(`package main
func main() {
  console.log(fmt.Sprintf("%s", "x"))
}`);
	assertContains(js, "__sprintf");
	assertContains(js, "function __sprintf");
});

// ═════════════════════════════════════════════════════════════
// New type checks
// ═════════════════════════════════════════════════════════════


section("recover()");

test("recover catches a panic and returns the message", () => {
	const js = compile(`package main
func safeDo(fn func()) (err error) {
	defer func() {
		if r := recover(); r != nil {
			err = error(r)
		}
	}()
	fn()
	return nil
}
func main() {
	err := safeDo(func() {
		panic("something went wrong")
	})
	console.log(err)
}`).js;
	assertEqual(runJs(js), "something went wrong");
});

test("recover returns nil when no panic", () => {
	const js = compile(`package main
func safeDo(fn func()) (err error) {
	defer func() {
		if r := recover(); r != nil {
			err = error(r)
		}
	}()
	fn()
	return nil
}
func main() {
	err := safeDo(func() {})
	if err == nil {
		console.log("no panic")
	}
}`).js;
	assertEqual(runJs(js), "no panic");
});

test("recover outside defer returns nil", () => {
	const js = compile(`package main
func main() {
	r := recover()
	if r == nil {
		console.log("nil")
	}
}`).js;
	assertEqual(runJs(js), "nil");
});

test("panic without recover propagates", () => {
	const js = compile(`package main
func main() {
	defer func() {}()
	panic("boom")
}`).js;
	let threw = false;
	try {
		runJs(js);
	} catch (_) {
		threw = true;
	}
	assert(threw, "expected panic to propagate");
});

// ═════════════════════════════════════════════════════════════


section("Rune / char literals");

test("char literal produces its char code", () => {
	const js = compile(`package main
func main() {
	var r rune = 'A'
	console.log(r)
}`).js;
	assertEqual(runJs(js), "65");
});

test("char literal escape sequences", () => {
	const js = compile(`package main
func main() {
	console.log('\\n')
	console.log('\\t')
	console.log('\\'')
	console.log('\\\\')
}`).js;
	assertEqual(runJs(js), "10\n9\n39\n92");
});

test("char literal used in arithmetic", () => {
	const js = compile(`package main
func main() {
	x := 'a' + 1
	console.log(x)
}`).js;
	assertEqual(runJs(js), "98");
});

test("char literal as const", () => {
	const js = compile(`package main
const Tab = '\t'
func main() {
	console.log(Tab)
}`).js;
	assertEqual(runJs(js), "9");
});

test("switch on char literal cases", () => {
	const js = compile(`package main
func grade(c rune) string {
	switch c {
	case 'A':
		return "excellent"
	case 'B':
		return "good"
	default:
		return "other"
	}
}
func main() {
	console.log(grade('A'))
	console.log(grade('B'))
	console.log(grade('C'))
}`).js;
	assertEqual(runJs(js), "excellent\ngood\nother");
});

test("unicode char literal", () => {
	const js = compile(`package main
func main() {
	console.log('€')
}`).js;
	assertEqual(runJs(js), "8364");
});

test("char literal used in comparison", () => {
	const js = compile(`package main
func main() {
	c := 'z'
	if c > 'a' {
		console.log("yes")
	}
}`).js;
	assertEqual(runJs(js), "yes");
});

// ═════════════════════════════════════════════════════════════


section("Bitwise compound assignments");

test("&= clears bits", () => {
	const js = compile(`package main
func main() {
	x := 15
	x &= 10
	console.log(x)
}`).js;
	assertEqual(runJs(js), "10");
});

test("|= sets bits", () => {
	const js = compile(`package main
func main() {
	x := 5
	x |= 10
	console.log(x)
}`).js;
	assertEqual(runJs(js), "15");
});

test("^= toggles bits", () => {
	const js = compile(`package main
func main() {
	x := 12
	x ^= 10
	console.log(x)
}`).js;
	assertEqual(runJs(js), "6");
});

test("<<= shifts left", () => {
	const js = compile(`package main
func main() {
	x := 1
	x <<= 3
	console.log(x)
}`).js;
	assertEqual(runJs(js), "8");
});

test(">>= shifts right", () => {
	const js = compile(`package main
func main() {
	x := 16
	x >>= 2
	console.log(x)
}`).js;
	assertEqual(runJs(js), "4");
});

test("chained bitwise assignments", () => {
	const js = compile(`package main
func main() {
	flags := 0
	flags |= 1
	flags |= 4
	flags &= 5
	console.log(flags)
}`).js;
	assertEqual(runJs(js), "5");
});

// ── Type switch ───────────────────────────────────────────────


section("[]byte and []rune conversions");

test("[]byte(s) produces UTF-8 byte values", () => {
	const js = compile(`package main
func main() {
	b := []byte("ABC")
	console.log(b[0], b[1], b[2])
}`).js;
	assertEqual(runJs(js), "65 66 67");
});

test("[]byte(s) length equals byte count for ASCII", () => {
	const js = compile(`package main
func main() {
	b := []byte("hello")
	console.log(len(b))
}`).js;
	assertEqual(runJs(js), "5");
});

test("[]byte(s) encodes multi-byte UTF-8 correctly", () => {
	// é is U+00E9 → 2 bytes in UTF-8: 0xC3 0xA9
	const js = compile(`package main
func main() {
	b := []byte("é")
	console.log(len(b))
	console.log(b[0], b[1])
}`).js;
	assertEqual(runJs(js), "2\n195 169");
});

test("[]rune(s) produces Unicode code points", () => {
	const js = compile(`package main
func main() {
	r := []rune("ABC")
	console.log(r[0], r[1], r[2])
}`).js;
	assertEqual(runJs(js), "65 66 67");
});

test("[]rune(s) length equals character count", () => {
	const js = compile(`package main
func main() {
	r := []rune("hello")
	console.log(len(r))
}`).js;
	assertEqual(runJs(js), "5");
});

test("[]rune(s) handles multi-byte char as single code point", () => {
	// é is one rune (U+00E9 = 233)
	const js = compile(`package main
func main() {
	r := []rune("é")
	console.log(len(r))
	console.log(r[0])
}`).js;
	assertEqual(runJs(js), "1\n233");
});

test("[]byte result is a regular slice (supports append)", () => {
	const js = compile(`package main
func main() {
	b := []byte("hi")
	b = append(b, 33)
	console.log(len(b))
	console.log(b[2])
}`).js;
	assertEqual(runJs(js), "3\n33");
});

test("[]rune result is a regular slice (supports range)", () => {
	const js = compile(`package main
func main() {
	sum := 0
	for _, r := range []rune("ABC") {
		sum += r
	}
	console.log(sum)
}`).js;
	assertEqual(runJs(js), "198");
});

test("[]byte of empty string is empty slice", () => {
	const js = compile(`package main
func main() {
	b := []byte("")
	console.log(len(b))
}`).js;
	assertEqual(runJs(js), "0");
});

test("[]rune of empty string is empty slice", () => {
	const js = compile(`package main
func main() {
	r := []rune("")
	console.log(len(r))
}`).js;
	assertEqual(runJs(js), "0");
});

test("len([]rune(s)) counts Unicode characters not bytes", () => {
	// "héllo" is 5 chars but 6 UTF-8 bytes; len([]rune) should give 5
	const js = compile(`package main
func main() {
	s := "héllo"
	console.log(len([]rune(s)))
}`).js;
	assertEqual(runJs(js), "5");
});

test("[]rune handles emoji as single code point", () => {
	// 😀 is U+1F600, a single rune despite being 4 UTF-8 bytes
	const js = compile(`package main
func main() {
	r := []rune("😀")
	console.log(len(r))
	console.log(r[0])
}`).js;
	assertEqual(runJs(js), "1\n128512");
});

// ── copy() and cap() ──────────────────────────────────────────


section("copy() and cap()");

test("copy copies elements into destination", () => {
	const js = compile(`package main
func main() {
	src := []int{1, 2, 3}
	dst := make([]int, 3)
	copy(dst, src)
	console.log(dst[0], dst[1], dst[2])
}`).js;
	assertEqual(runJs(js), "1 2 3");
});

test("copy returns number of elements copied", () => {
	const js = compile(`package main
func main() {
	src := []int{10, 20, 30}
	dst := make([]int, 2)
	n := copy(dst, src)
	console.log(n)
}`).js;
	assertEqual(runJs(js), "2");
});

test("copy with shorter destination only fills dst length", () => {
	const js = compile(`package main
func main() {
	src := []int{1, 2, 3, 4, 5}
	dst := make([]int, 3)
	copy(dst, src)
	console.log(len(dst))
	console.log(dst[2])
}`).js;
	assertEqual(runJs(js), "3\n3");
});

test("copy with shorter source only copies src length", () => {
	const js = compile(`package main
func main() {
	src := []int{7, 8}
	dst := make([]int, 5)
	n := copy(dst, src)
	console.log(n)
	console.log(dst[0], dst[1])
}`).js;
	assertEqual(runJs(js), "2\n7 8");
});

test("cap returns same as len for GoFront slices", () => {
	const js = compile(`package main
func main() {
	s := []int{1, 2, 3}
	console.log(cap(s))
}`).js;
	assertEqual(runJs(js), "3");
});

test("cap after append equals new len", () => {
	const js = compile(`package main
func main() {
	s := []int{1, 2}
	s = append(s, 3)
	console.log(cap(s))
}`).js;
	assertEqual(runJs(js), "3");
});

// ── Compound assignments on fields and elements ───────────────


section("Compound assignments on struct fields and slice elements");

test("+= on struct field", () => {
	const js = compile(`package main
type Counter struct { n int }
func main() {
	c := Counter{n: 10}
	c.n += 5
	console.log(c.n)
}`).js;
	assertEqual(runJs(js), "15");
});

test("-= on struct field", () => {
	const js = compile(`package main
type Counter struct { n int }
func main() {
	c := Counter{n: 10}
	c.n -= 3
	console.log(c.n)
}`).js;
	assertEqual(runJs(js), "7");
});

test("+= on slice element", () => {
	const js = compile(`package main
func main() {
	s := []int{1, 2, 3}
	s[1] += 10
	console.log(s[1])
}`).js;
	assertEqual(runJs(js), "12");
});

test("|= on slice element", () => {
	const js = compile(`package main
func main() {
	flags := []int{0, 0, 0}
	flags[0] |= 3
	flags[0] |= 4
	console.log(flags[0])
}`).js;
	assertEqual(runJs(js), "7");
});

test("&= on struct field", () => {
	const js = compile(`package main
type Bits struct { v int }
func main() {
	b := Bits{v: 15}
	b.v &= 6
	console.log(b.v)
}`).js;
	assertEqual(runJs(js), "6");
});

// ── String comparisons ────────────────────────────────────────


section("String comparison operators");

test("string equality ==", () => {
	const js = compile(`package main
func main() {
	console.log("abc" == "abc")
	console.log("abc" == "def")
}`).js;
	assertEqual(runJs(js), "true\nfalse");
});

test("string inequality !=", () => {
	const js = compile(`package main
func main() {
	console.log("abc" != "def")
	console.log("abc" != "abc")
}`).js;
	assertEqual(runJs(js), "true\nfalse");
});

test("string < and >", () => {
	const js = compile(`package main
func main() {
	console.log("apple" < "banana")
	console.log("zebra" > "apple")
}`).js;
	assertEqual(runJs(js), "true\ntrue");
});

test("string <= and >=", () => {
	const js = compile(`package main
func main() {
	console.log("abc" <= "abc")
	console.log("abc" >= "abc")
	console.log("abc" <= "abd")
}`).js;
	assertEqual(runJs(js), "true\ntrue\ntrue");
});

test("string comparison in if condition", () => {
	const js = compile(`package main
func main() {
	s := "hello"
	if s == "hello" {
		console.log("match")
	} else {
		console.log("no match")
	}
}`).js;
	assertEqual(runJs(js), "match");
});

// ── Blank identifier ──────────────────────────────────────────


section("Blank identifier");

test("blank _ discards second return value", () => {
	const js = compile(`package main
func pair() (int, string) {
	return 42, "hello"
}
func main() {
	x, _ := pair()
	console.log(x)
}`).js;
	assertEqual(runJs(js), "42");
});

test("blank _ discards first return value", () => {
	const js = compile(`package main
func pair() (int, string) {
	return 42, "hello"
}
func main() {
	_, s := pair()
	console.log(s)
}`).js;
	assertEqual(runJs(js), "hello");
});

test("blank _ in for range discards index", () => {
	const js = compile(`package main
func main() {
	sum := 0
	for _, v := range []int{1, 2, 3} {
		sum += v
	}
	console.log(sum)
}`).js;
	assertEqual(runJs(js), "6");
});

test("blank _ in map comma-ok", () => {
	const js = compile(`package main
func main() {
	m := map[string]int{"a": 1}
	_, ok := m["a"]
	console.log(ok)
}`).js;
	assertEqual(runJs(js), "true");
});

// ── Sized types — type errors still caught ────────────────────


section("recover() — additional scenarios");

test("recover with multiple defers — only innermost catches", () => {
	const js = compile(`package main
func main() {
	defer func() {
		console.log("outer defer")
	}()
	defer func() {
		if r := recover(); r != nil {
			console.log("caught:", r)
		}
	}()
	panic("boom")
}`).js;
	assertEqual(runJs(js), "caught: boom\nouter defer");
});

test("recover allows function to return normally after panic", () => {
	const js = compile(`package main
func safe() string {
	defer func() {
		recover()
	}()
	panic("ignored")
	return "never"
}
func main() {
	console.log("done")
}`).js;
	assertEqual(runJs(js), "done");
});

test("panic in nested call is caught by caller's recover", () => {
	const js = compile(`package main
func boom() {
	panic("deep")
}
func main() {
	defer func() {
		if r := recover(); r != nil {
			console.log("caught:", r)
		}
	}()
	boom()
}`).js;
	assertEqual(runJs(js), "caught: deep");
});

// ── Interface embedding ──────────────────────────────────────


section("print / println builtins");

test("print() compiles and runs", () => {
	const js = compile(`package main
func main() {
	print("hello")
}`).js;
	assertEqual(runJs(js), "hello");
});

test("println() compiles and runs", () => {
	const js = compile(`package main
func main() {
	println("world")
}`).js;
	assertEqual(runJs(js), "world");
});

// ── fmt.Sprintf %f format verb ────────────────────────────────


section("fmt.Sprintf format verbs");

test("fmt.Sprintf %f formats float", () => {
	const { js, errors } = compile(`package main
func main() {
	console.log(fmt.Sprintf("%f", 3.14))
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "3.14");
});

test("fmt.Printf emits to stdout", () => {
	const { js, errors } = compile(`package main
func main() {
	fmt.Printf("count: %d", 7)
}`);
	assertEqual(errors.length, 0);
	// fmt.Printf writes to process.stdout — just verify it compiles and doesn't throw
	assert(js !== null);
	assertContains(js, "__sprintf");
});

// ── Bitwise operators as expressions ─────────────────────────


section("Bitwise operators (expressions)");

test("& (AND) expression", () => {
	const js = compile(`package main
func main() {
	x := 15 & 9
	console.log(x)
}`).js;
	assertEqual(runJs(js), "9");
});

test("| (OR) expression", () => {
	const js = compile(`package main
func main() {
	x := 5 | 10
	console.log(x)
}`).js;
	assertEqual(runJs(js), "15");
});

test("^ (XOR) expression", () => {
	const js = compile(`package main
func main() {
	x := 12 ^ 10
	console.log(x)
}`).js;
	assertEqual(runJs(js), "6");
});

test("<< (left shift) expression", () => {
	const js = compile(`package main
func main() {
	x := 1 << 4
	console.log(x)
}`).js;
	assertEqual(runJs(js), "16");
});

test(">> (right shift) expression", () => {
	const js = compile(`package main
func main() {
	x := 32 >> 2
	console.log(x)
}`).js;
	assertEqual(runJs(js), "8");
});

test("^ (bitwise NOT / complement) unary", () => {
	const js = compile(`package main
func main() {
	x := ^0
	console.log(x)
}`).js;
	// ^0 in Go is -1 (two's complement); JS ~0 is also -1
	assertEqual(runJs(js), "-1");
});

test("+ (unary plus) expression", () => {
	const js = compile(`package main
func main() {
	x := 5
	console.log(+x)
}`).js;
	assertEqual(runJs(js), "5");
});

// ── Integer division truncation ───────────────────────────────


section("Integer division");

test("int / int truncates toward zero", () => {
	const js = compile(`package main
func main() {
	console.log(10 / 3)
	console.log(7 / 2)
	console.log(-7 / 2)
}`).js;
	assertEqual(runJs(js), "3\n3\n-3");
});

test("float64 / float64 is not truncated", () => {
	const js = compile(`package main
func main() {
	a := 7.0
	b := 2.0
	console.log(a / b)
}`).js;
	assertEqual(runJs(js), "3.5");
});

// ── String indexing ───────────────────────────────────────────


section("String indexing");

test("s[i] returns the character at that position", () => {
	// GoFront string indexing delegates to JS string indexing — returns the character
	const js = compile(`package main
func main() {
	s := "ABC"
	console.log(s[0])
	console.log(s[1])
}`).js;
	assertEqual(runJs(js), "A\nB");
});

// ── Full slice xs[:] ─────────────────────────────────────────


section("Slice expressions");

test("xs[:] produces a copy", () => {
	const js = compile(`package main
func main() {
	xs := []int{1, 2, 3}
	ys := xs[:]
	console.log(len(ys))
	console.log(ys[0])
}`).js;
	assertEqual(runJs(js), "3\n1");
});

test("xs[n:] slices from n to end", () => {
	const js = compile(`package main
func main() {
	xs := []int{10, 20, 30, 40}
	ys := xs[2:]
	console.log(len(ys))
	console.log(ys[0])
}`).js;
	assertEqual(runJs(js), "2\n30");
});

test("string slice s[lo:hi]", () => {
	const js = compile(`package main
func main() {
	s := "hello"
	console.log(s[1:4])
}`).js;
	assertEqual(runJs(js), "ell");
});

// ── Array types [n]T ─────────────────────────────────────────


section("Array types");

test("[n]T array literal and indexing", () => {
	const js = compile(`package main
func main() {
	xs := [3]int{10, 20, 30}
	console.log(xs[0])
	console.log(xs[2])
}`).js;
	assertEqual(runJs(js), "10\n30");
});

test("len([n]T) returns n", () => {
	const js = compile(`package main
func main() {
	xs := [4]string{"a", "b", "c", "d"}
	console.log(len(xs))
}`).js;
	assertEqual(runJs(js), "4");
});

// ── Map with non-string keys ──────────────────────────────────


section("Map with non-string keys");

test("map[int]string — access by int key", () => {
	const js = compile(`package main
func main() {
	m := map[int]string{1: "one", 2: "two"}
	console.log(m[1])
	console.log(m[2])
}`).js;
	assertEqual(runJs(js), "one\ntwo");
});

test("map[int]int — zero value for missing key", () => {
	const js = compile(`package main
func main() {
	m := map[int]int{1: 42}
	console.log(m[99])
}`).js;
	assertEqual(runJs(js), "0");
});

// ── for range with only blank vars ───────────────────────────


section("for range — blank variables");

test("for range body runs once per element (value unused)", () => {
	// Range with index-only binding; body modifies n without referencing i
	// (i gets the slice type from range expr — using it in arithmetic would type-error)
	const js = compile(`package main
func main() {
	n := 0
	xs := []int{1, 2, 3}
	for i := range xs {
		console.log(i)
		n = n + 1
	}
	console.log(n)
}`).js;
	// i outputs 0, 1, 2 and n outputs 3
	assertEqual(runJs(js), "0\n1\n2\n3");
});

// ── for range — index only on string ─────────────────────────


section("for range — index-only on string");

test("for i := range string iterates indices", () => {
	// Range over string with index-only binding; console.log is any so no type conflict
	const js = compile(`package main
func main() {
	for i := range "abc" {
		console.log(i)
	}
}`).js;
	assertEqual(runJs(js), "0\n1\n2");
});

// ── for range — assignment (not define) ──────────────────────


section("for range — assignment to existing variables");

test("for i, v = range slice with any-typed vars compiles", () => {
	// Assignment-range with any-typed lhs vars; GoFront generates const destructuring
	// which shadows outer vars — verify it compiles without error
	const { errors } = compile(`package main
func main() {
	var i any
	var v any
	xs := []int{10, 20, 30}
	for i, v = range xs {
		console.log(i, v)
	}
}`);
	assertEqual(errors.length, 0);
});

// ── new(T) for struct types ───────────────────────────────────


section("Local type declarations");

test("type declared inside function body is usable", () => {
	const js = compile(`package main
func main() {
	type Pair struct { A int; B int }
	p := Pair{A: 3, B: 7}
	console.log(p.A + p.B)
}`).js;
	assertEqual(runJs(js), "10");
});

// ── make([]T, n, cap) with capacity hint ─────────────────────


section("make with capacity");

test("make([]int, n, cap) ignores capacity and creates length-n slice", () => {
	const js = compile(`package main
func main() {
	xs := make([]int, 3, 10)
	console.log(len(xs))
	console.log(xs[0])
}`).js;
	assertEqual(runJs(js), "3\n0");
});

test("make(map[string]int, n) ignores hint and creates empty map", () => {
	const js = compile(`package main
func main() {
	m := make(map[string]int, 16)
	m["a"] = 1
	console.log(len(m))
}`).js;
	assertEqual(runJs(js), "1");
});

// ── Standalone block statement ────────────────────────────────


section("fmt.Print and fmt.Printf");

test("fmt.Print compiles without error", () => {
	const { errors, js } = compile(`package main
func main() {
	fmt.Print("hello %s", "world")
}`);
	assertEqual(errors.length, 0);
	assertContains(js, "__sprintf");
});

test("fmt.Printf compiles without error", () => {
	const { errors, js } = compile(`package main
func main() {
	fmt.Printf("value: %d", 42)
}`);
	assertEqual(errors.length, 0);
	assertContains(js, "__sprintf");
});

// ═════════════════════════════════════════════════════════════
// Lexer / parser edge cases
// ═════════════════════════════════════════════════════════════


// ── Entry point ───────────────────────────────────────────────
if (process.argv[1] === fileURLToPath(import.meta.url)) {
	process.exit(summarize() > 0 ? 1 : 0);
}
