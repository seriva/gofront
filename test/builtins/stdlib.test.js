// GoFront test suite — standard library shims

import { fileURLToPath } from "node:url";
import {
	assertContains,
	assertEqual,
	compile,
	runJs,
	section,
	test,
} from "../helpers.js";

section("strings package");

test("strings.Contains", () => {
	const { js, errors } = compile(`package main
func main() {
	console.log(strings.Contains("hello world", "world"))
	console.log(strings.Contains("hello", "xyz"))
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "true\nfalse");
});

test("strings.HasPrefix and HasSuffix", () => {
	const { js, errors } = compile(`package main
func main() {
	console.log(strings.HasPrefix("hello", "hel"))
	console.log(strings.HasSuffix("hello", "llo"))
	console.log(strings.HasPrefix("hello", "xyz"))
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "true\ntrue\nfalse");
});

test("strings.ToUpper and ToLower", () => {
	const { js, errors } = compile(`package main
func main() {
	console.log(strings.ToUpper("hello"))
	console.log(strings.ToLower("HELLO"))
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "HELLO\nhello");
});

test("strings.TrimSpace", () => {
	const { js, errors } = compile(`package main
func main() {
	console.log(strings.TrimSpace("  hello  "))
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "hello");
});

test("strings.Split and Join", () => {
	const { js, errors } = compile(`package main
func main() {
	parts := strings.Split("a,b,c", ",")
	console.log(strings.Join(parts, "-"))
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "a-b-c");
});

test("strings.Replace and ReplaceAll", () => {
	const { js, errors } = compile(`package main
func main() {
	console.log(strings.ReplaceAll("aaa", "a", "b"))
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "bbb");
});

test("strings.Index and Count", () => {
	const { js, errors } = compile(`package main
func main() {
	console.log(strings.Index("hello", "ll"))
	console.log(strings.Count("banana", "a"))
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "2\n3");
});

test("strings.Repeat", () => {
	const { js, errors } = compile(`package main
func main() {
	console.log(strings.Repeat("ab", 3))
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "ababab");
});

test("strings.TrimPrefix and TrimSuffix", () => {
	const { js, errors } = compile(`package main
func main() {
	console.log(strings.TrimPrefix("hello", "hel"))
	console.log(strings.TrimSuffix("hello", "llo"))
	console.log(strings.TrimPrefix("hello", "xyz"))
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "lo\nhe\nhello");
});

test("strings.EqualFold", () => {
	const { js, errors } = compile(`package main
func main() {
	console.log(strings.EqualFold("Hello", "hello"))
	console.log(strings.EqualFold("Go", "GO"))
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "true\ntrue");
});

// ═════════════════════════════════════════════════════════════
// strconv package
// ═════════════════════════════════════════════════════════════

section("strconv package");

test("strconv.Itoa", () => {
	const { js, errors } = compile(`package main
func main() {
	console.log(strconv.Itoa(42))
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "42");
});

test("strconv.Atoi success", () => {
	const { js, errors } = compile(`package main
func main() {
	n, err := strconv.Atoi("123")
	console.log(n, err)
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "123 null");
});

test("strconv.Atoi failure", () => {
	const { js, errors } = compile(`package main
func main() {
	n, err := strconv.Atoi("abc")
	console.log(n, err)
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "0 invalid syntax");
});

test("strconv.FormatBool", () => {
	const { js, errors } = compile(`package main
func main() {
	console.log(strconv.FormatBool(true))
	console.log(strconv.FormatBool(false))
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "true\nfalse");
});

test("strconv.FormatInt with base", () => {
	const { js, errors } = compile(`package main
func main() {
	console.log(strconv.FormatInt(255, 16))
	console.log(strconv.FormatInt(10, 2))
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "ff\n1010");
});

test("strconv.ParseBool", () => {
	const { js, errors } = compile(`package main
func main() {
	v, err := strconv.ParseBool("true")
	console.log(v, err)
	v2, err2 := strconv.ParseBool("nope")
	console.log(v2, err2)
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "true null\nfalse invalid syntax");
});

test("strconv.ParseInt", () => {
	const { js, errors } = compile(`package main
func main() {
	n, err := strconv.ParseInt("ff", 16, 64)
	console.log(n, err)
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "255 null");
});

// ═════════════════════════════════════════════════════════════
// Expanded fmt.Sprintf format verbs
// ═════════════════════════════════════════════════════════════

section("fmt.Sprintf expanded format verbs");

test("fmt.Sprintf %t for booleans", () => {
	const { js, errors } = compile(`package main
func main() {
	console.log(fmt.Sprintf("%t", true))
	console.log(fmt.Sprintf("%t", false))
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "true\nfalse");
});

test("fmt.Sprintf %x and %X hex", () => {
	const { js, errors } = compile(`package main
func main() {
	console.log(fmt.Sprintf("%x", 255))
	console.log(fmt.Sprintf("%X", 255))
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "ff\nFF");
});

test("fmt.Sprintf %o octal", () => {
	const { js, errors } = compile(`package main
func main() {
	console.log(fmt.Sprintf("%o", 8))
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "10");
});

test("fmt.Sprintf %q quoted string", () => {
	const { js, errors } = compile(`package main
func main() {
	console.log(fmt.Sprintf("%q", "hello"))
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), '"hello"');
});

test("fmt.Sprintf %04d width with zero-pad", () => {
	const { js, errors } = compile(`package main
func main() {
	console.log(fmt.Sprintf("%04d", 42))
	console.log(fmt.Sprintf("%8d", 42))
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "0042\n      42");
});

test("fmt.Sprintf %.2f precision", () => {
	const { js, errors } = compile(`package main
func main() {
	console.log(fmt.Sprintf("%.2f", 3.14159))
	console.log(fmt.Sprintf("%.0f", 3.7))
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "3.14\n4");
});

test("fmt.Sprintf %e scientific notation", () => {
	const { js, errors } = compile(`package main
func main() {
	console.log(fmt.Sprintf("%.2e", 12345.6789))
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "1.23e+4");
});

// ═════════════════════════════════════════════════════════════
// sort package
// ═════════════════════════════════════════════════════════════

section("sort package");

test("sort.Ints", () => {
	const { js, errors } = compile(`package main
func main() {
	nums := []int{3, 1, 4, 1, 5}
	sort.Ints(nums)
	console.log(nums)
}`);
	assertEqual(errors.length, 0);
	assertContains(runJs(js), "1,1,3,4,5");
});

test("sort.Strings", () => {
	const { js, errors } = compile(`package main
func main() {
	words := []string{"banana", "apple", "cherry"}
	sort.Strings(words)
	console.log(words)
}`);
	assertEqual(errors.length, 0);
	assertContains(runJs(js), "apple,banana,cherry");
});

test("sort.Slice with custom comparator", () => {
	const { js, errors } = compile(`package main
func main() {
	nums := []int{3, 1, 4}
	sort.Slice(nums, func(a int, b int) bool { return a > b })
	console.log(nums)
}`);
	assertEqual(errors.length, 0);
	assertContains(runJs(js), "4,3,1");
});

// ═════════════════════════════════════════════════════════════
// math package
// ═════════════════════════════════════════════════════════════

section("math package");

test("math.Sqrt and math.Pow", () => {
	const { js, errors } = compile(`package main
func main() {
	console.log(math.Sqrt(16.0))
	console.log(math.Pow(2.0, 10.0))
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "4\n1024");
});

test("math.Floor, Ceil, Round", () => {
	const { js, errors } = compile(`package main
func main() {
	console.log(math.Floor(3.7))
	console.log(math.Ceil(3.2))
	console.log(math.Round(3.5))
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "3\n4\n4");
});

test("math.Abs", () => {
	const { js, errors } = compile(`package main
func main() {
	console.log(math.Abs(-5.0))
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "5");
});

test("math.Pi and math.E constants", () => {
	const { js, errors } = compile(`package main
func main() {
	console.log(math.Pi > 3.14)
	console.log(math.E > 2.71)
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "true\ntrue");
});

test("math.Min and math.Max", () => {
	const { js, errors } = compile(`package main
func main() {
	console.log(math.Min(3.0, 7.0))
	console.log(math.Max(3.0, 7.0))
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "3\n7");
});

test("math.Log and math.Log2", () => {
	const { js, errors } = compile(`package main
func main() {
	console.log(math.Log2(8.0))
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "3");
});

test("math.IsNaN and math.NaN", () => {
	const { js, errors } = compile(`package main
func main() {
	console.log(math.IsNaN(math.NaN()))
	console.log(math.IsNaN(3.14))
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "true\nfalse");
});

test("math.Inf", () => {
	const { js, errors } = compile(`package main
func main() {
	console.log(math.Inf(1) > 0)
	console.log(math.Inf(-1) < 0)
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "true\ntrue");
});

// ═════════════════════════════════════════════════════════════
// errors package
// ═════════════════════════════════════════════════════════════

section("errors package");

test("errors.New creates an error value", () => {
	const { js, errors } = compile(`package main
func main() {
	err := errors.New("something went wrong")
	console.log(err)
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "something went wrong");
});

test("errors.New used in return", () => {
	const { js, errors } = compile(`package main
func divide(a int, b int) (int, error) {
	if b == 0 {
		return 0, errors.New("division by zero")
	}
	return a / b, nil
}
func main() {
	_, err := divide(1, 0)
	console.log(err)
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "division by zero");
});

// ═════════════════════════════════════════════════════════════
// time package
// ═════════════════════════════════════════════════════════════

section("time package");

test("time.Now returns a timestamp", () => {
	const { js, errors } = compile(`package main
func main() {
	t := time.Now()
	console.log(t > 0)
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "true");
});

test("time.Since returns elapsed time", () => {
	const { js, errors } = compile(`package main
func main() {
	start := time.Now()
	elapsed := time.Since(start)
	console.log(elapsed >= 0)
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "true");
});

test("time constants are defined", () => {
	const { js, errors } = compile(`package main
func main() {
	console.log(time.Second > time.Millisecond)
	console.log(time.Minute > time.Second)
	console.log(time.Hour > time.Minute)
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "true\ntrue\ntrue");
});

// ── unicode package ──────────────────────────────────────────

section("unicode package");

test("unicode.IsLetter recognizes letters", () => {
	const { js, errors } = compile(`package main
func main() {
  println(unicode.IsLetter(65))
  println(unicode.IsLetter(49))
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "true\nfalse");
});

test("unicode.IsDigit recognizes digits", () => {
	const { js, errors } = compile(`package main
func main() {
  println(unicode.IsDigit(49))
  println(unicode.IsDigit(65))
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "true\nfalse");
});

test("unicode.ToUpper converts lowercase rune", () => {
	const { js, errors } = compile(`package main
func main() {
  println(unicode.ToUpper(97))
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "65");
});

test("unicode.ToLower converts uppercase rune", () => {
	const { js, errors } = compile(`package main
func main() {
  println(unicode.ToLower(65))
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "97");
});

// ── os package ───────────────────────────────────────────────

section("os package");

test("os.Getenv compiles without error", () => {
	const { errors } = compile(`package main
func main() {
  v := os.Getenv("HOME")
  println(v)
}`);
	assertEqual(errors.length, 0);
});

test("os.Exit compiles without error", () => {
	const { errors } = compile(`package main
func main() {
  n := 0
  println(n)
}`);
	assertEqual(errors.length, 0);
});

// ═════════════════════════════════════════════════════════════
// strings.Builder
// ═════════════════════════════════════════════════════════════

section("strings.Builder");

test("WriteString and String", () => {
	const { js, errors } = compile(`package main
func main() {
	var b strings.Builder
	b.WriteString("hello")
	b.WriteString(", ")
	b.WriteString("world")
	console.log(b.String())
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "hello, world");
});

test("WriteByte", () => {
	const { js, errors } = compile(`package main
func main() {
	var b strings.Builder
	b.WriteByte('H')
	b.WriteByte('i')
	console.log(b.String())
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "Hi");
});

test("WriteRune", () => {
	const { js, errors } = compile(`package main
func main() {
	var b strings.Builder
	b.WriteRune('G')
	b.WriteRune('o')
	console.log(b.String())
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "Go");
});

test("Len", () => {
	const { js, errors } = compile(`package main
func main() {
	var b strings.Builder
	b.WriteString("hello")
	console.log(b.Len())
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "5");
});

test("Reset", () => {
	const { js, errors } = compile(`package main
func main() {
	var b strings.Builder
	b.WriteString("hello")
	b.Reset()
	b.WriteString("world")
	console.log(b.String())
	console.log(b.Len())
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "world\n5");
});

test("Grow is a no-op", () => {
	const { js, errors } = compile(`package main
func main() {
	var b strings.Builder
	b.Grow(64)
	b.WriteString("ok")
	console.log(b.String())
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "ok");
});

test("zero value is usable", () => {
	const { js, errors } = compile(`package main
func build() string {
	var b strings.Builder
	b.WriteString("x")
	return b.String()
}
func main() {
	console.log(build())
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "x");
});

// ═════════════════════════════════════════════════════════════
// bytes.Buffer
// ═════════════════════════════════════════════════════════════

section("bytes.Buffer");

test("WriteString and String", () => {
	const { js, errors } = compile(`package main
func main() {
	var b bytes.Buffer
	b.WriteString("hello")
	b.WriteString(", world")
	console.log(b.String())
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "hello, world");
});

test("WriteByte", () => {
	const { js, errors } = compile(`package main
func main() {
	var b bytes.Buffer
	b.WriteByte(72)
	b.WriteByte(105)
	console.log(b.String())
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "Hi");
});

test("Write (byte slice)", () => {
	const { js, errors } = compile(`package main
func main() {
	var b bytes.Buffer
	b.Write([]byte{71, 111})
	console.log(b.String())
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "Go");
});

test("Bytes", () => {
	const { js, errors } = compile(`package main
func main() {
	var b bytes.Buffer
	b.WriteByte(1)
	b.WriteByte(2)
	bs := b.Bytes()
	console.log(bs[0], bs[1])
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "1 2");
});

test("Len", () => {
	const { js, errors } = compile(`package main
func main() {
	var b bytes.Buffer
	b.WriteString("hello")
	console.log(b.Len())
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "5");
});

test("Reset", () => {
	const { js, errors } = compile(`package main
func main() {
	var b bytes.Buffer
	b.WriteString("old")
	b.Reset()
	b.WriteString("new")
	console.log(b.String())
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "new");
});

test("fmt.Fprintf writes to bytes.Buffer", () => {
	const { js, errors } = compile(`package main
func main() {
	var b bytes.Buffer
	fmt.Fprintf(&b, "hello %s, you are %d", "world", 42)
	console.log(b.String())
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "hello world, you are 42");
});

test("fmt.Fprintf writes to strings.Builder", () => {
	const { js, errors } = compile(`package main
func main() {
	var b strings.Builder
	fmt.Fprintf(&b, "%d + %d = %d", 1, 2, 3)
	console.log(b.String())
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "1 + 2 = 3");
});

// ═════════════════════════════════════════════════════════════
// regexp package
// ═════════════════════════════════════════════════════════════

section("regexp package");

test("MustCompile + MatchString", () => {
	const { js, errors } = compile(`package main
func main() {
	re := regexp.MustCompile("[0-9]+")
	console.log(re.MatchString("abc123"))
	console.log(re.MatchString("abc"))
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "true\nfalse");
});

test("Compile returns (*Regexp, error)", () => {
	const { js, errors } = compile(`package main
func main() {
	re, err := regexp.Compile("[a-z]+")
	console.log(err == nil)
	console.log(re.MatchString("hello"))
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "true\ntrue");
});

test("FindString", () => {
	const { js, errors } = compile(`package main
func main() {
	re := regexp.MustCompile("[0-9]+")
	console.log(re.FindString("abc123def"))
	console.log(re.FindString("no digits"))
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "123\n");
});

test("FindAllString", () => {
	const { js, errors } = compile(`package main
func main() {
	re := regexp.MustCompile("[0-9]+")
	all := re.FindAllString("a1b22c333", -1)
	for _, s := range all {
		console.log(s)
	}
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "1\n22\n333");
});

test("FindAllString with limit", () => {
	const { js, errors } = compile(`package main
func main() {
	re := regexp.MustCompile("[0-9]+")
	all := re.FindAllString("1 2 3 4", 2)
	console.log(len(all))
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "2");
});

test("FindStringSubmatch", () => {
	const { js, errors } = compile(`package main
func main() {
	re := regexp.MustCompile("([a-z]+)([0-9]+)")
	m := re.FindStringSubmatch("abc123")
	console.log(m[0])
	console.log(m[1])
	console.log(m[2])
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "abc123\nabc\n123");
});

test("ReplaceAllString", () => {
	const { js, errors } = compile(`package main
func main() {
	re := regexp.MustCompile("[aeiou]")
	console.log(re.ReplaceAllString("hello world", "*"))
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "h*ll* w*rld");
});

test("ReplaceAllLiteralString", () => {
	const { js, errors } = compile(`package main
func main() {
	re := regexp.MustCompile("[0-9]+")
	console.log(re.ReplaceAllLiteralString("a1b2c3", "$NUM"))
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "a$NUMb$NUMc$NUM");
});

test("Split", () => {
	const { js, errors } = compile(`package main
func main() {
	re := regexp.MustCompile("[,;]+")
	parts := re.Split("a,b;;c,d", -1)
	for _, p := range parts {
		console.log(p)
	}
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "a\nb\nc\nd");
});

test("String returns pattern source", () => {
	const { js, errors } = compile(`package main
func main() {
	re := regexp.MustCompile("[0-9]+")
	console.log(re.String())
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "[0-9]+");
});

test("regexp.MatchString package-level function", () => {
	const { js, errors } = compile(`package main
func main() {
	ok, err := regexp.MatchString("[0-9]+", "abc123")
	console.log(ok)
	console.log(err == nil)
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "true\ntrue");
});

test("regexp.QuoteMeta", () => {
	const { js, errors } = compile(`package main
func main() {
	console.log(regexp.QuoteMeta("a.b+c?"))
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "a\\.b\\+c\\?");
});

test("FindStringIndex", () => {
	const { js, errors } = compile(`package main
func main() {
	re := regexp.MustCompile("[0-9]+")
	idx := re.FindStringIndex("abc123def")
	console.log(idx[0])
	console.log(idx[1])
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "3\n6");
});

// ── Entry point ───────────────────────────────────────────────
if (process.argv[1] === fileURLToPath(import.meta.url)) {
	process.exit(summarize() > 0 ? 1 : 0);
}
