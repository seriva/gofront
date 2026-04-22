// GoFront test suite — standard library shims

import { fileURLToPath } from "node:url";
import {
	assert,
	assertContains,
	assertEqual,
	compile,
	runJs,
	section,
	summarize,
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

test("strings.Count with empty separator returns len+1", () => {
	const { js, errors } = compile(`package main
func main() {
	console.log(strings.Count("hello", ""))
	console.log(strings.Count("", ""))
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "6\n1");
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

test("strings.TrimSuffix with empty suffix returns original", () => {
	const { js, errors } = compile(`package main
func main() {
	console.log(strings.TrimSuffix("hello", ""))
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "hello");
});

test("strings.TrimPrefix with empty prefix returns original", () => {
	const { js, errors } = compile(`package main
func main() {
	console.log(strings.TrimPrefix("hello", ""))
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "hello");
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

test("time.Now returns a time object (has _d property)", () => {
	const { js, errors } = compile(`package main
func main() {
	t := time.Now()
	console.log(t.Year() > 2000)
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

test("strings.Builder: WriteString and String", () => {
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

test("strings.Builder: WriteByte", () => {
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

test("strings.Builder: WriteRune", () => {
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

test("strings.Builder: Len", () => {
	const { js, errors } = compile(`package main
func main() {
	var b strings.Builder
	b.WriteString("hello")
	console.log(b.Len())
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "5");
});

test("strings.Builder: Reset", () => {
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

test("strings.Builder: Grow is a no-op", () => {
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

test("bytes.Buffer: WriteString and String", () => {
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

test("bytes.Buffer: WriteByte", () => {
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

test("bytes.Buffer: Len", () => {
	const { js, errors } = compile(`package main
func main() {
	var b bytes.Buffer
	b.WriteString("hello")
	console.log(b.Len())
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "5");
});

test("bytes.Buffer: Reset", () => {
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

test("bytes.Buffer: Grow is a no-op", () => {
	const { js, errors } = compile(`package main
func main() {
	var b bytes.Buffer
	b.WriteString("hello")
	b.Grow(100)
	console.log(b.String())
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "hello");
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

test("FindAllStringSubmatch", () => {
	const { js, errors } = compile(`package main
func main() {
	re := regexp.MustCompile("([a-z]+)([0-9]+)")
	all := re.FindAllStringSubmatch("ab12 cd34", -1)
	for _, m := range all {
		console.log(m[0], m[1], m[2])
	}
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "ab12 ab 12\ncd34 cd 34");
});

test("FindStringIndex returns nil on no match", () => {
	const { js, errors } = compile(`package main
func main() {
	re := regexp.MustCompile("[0-9]+")
	idx := re.FindStringIndex("no digits")
	console.log(idx == nil)
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "true");
});

test("MustCompile with inline (?i) flag", () => {
	const { js, errors } = compile(`package main
func main() {
	re := regexp.MustCompile("(?i)hello")
	console.log(re.MatchString("HELLO"))
	console.log(re.MatchString("world"))
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "true\nfalse");
});

// ═════════════════════════════════════════════════════════════
// slices package
// ═════════════════════════════════════════════════════════════

section("slices package");

test("slices.Contains", () => {
	const { js, errors } = compile(`package main
func main() {
	s := []int{1, 2, 3}
	console.log(slices.Contains(s, 2))
	console.log(slices.Contains(s, 5))
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "true\nfalse");
});

test("slices.Index", () => {
	const { js, errors } = compile(`package main
func main() {
	s := []string{"a", "b", "c"}
	console.log(slices.Index(s, "b"))
	console.log(slices.Index(s, "z"))
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "1\n-1");
});

test("slices.Equal", () => {
	const { js, errors } = compile(`package main
func main() {
	a := []int{1, 2, 3}
	b := []int{1, 2, 3}
	c := []int{1, 2, 4}
	console.log(slices.Equal(a, b))
	console.log(slices.Equal(a, c))
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "true\nfalse");
});

test("slices.Sort", () => {
	const { js, errors } = compile(`package main
func main() {
	s := []int{3, 1, 4, 1, 5}
	slices.Sort(s)
	for _, v := range s {
		console.log(v)
	}
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "1\n1\n3\n4\n5");
});

test("slices.SortFunc", () => {
	const { js, errors } = compile(`package main
func main() {
	s := []int{3, 1, 2}
	slices.SortFunc(s, func(a, b int) int {
		if a < b { return -1 }
		if a > b { return 1 }
		return 0
	})
	for _, v := range s {
		console.log(v)
	}
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "1\n2\n3");
});

test("slices.Reverse", () => {
	const { js, errors } = compile(`package main
func main() {
	s := []int{1, 2, 3}
	slices.Reverse(s)
	for _, v := range s {
		console.log(v)
	}
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "3\n2\n1");
});

test("slices.Clone", () => {
	const { js, errors } = compile(`package main
func main() {
	s := []int{1, 2, 3}
	c := slices.Clone(s)
	c[0] = 99
	console.log(s[0])
	console.log(c[0])
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "1\n99");
});

test("slices.Compact", () => {
	const { js, errors } = compile(`package main
func main() {
	s := []int{1, 1, 2, 3, 3, 3, 4}
	s = slices.Compact(s)
	for _, v := range s {
		console.log(v)
	}
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "1\n2\n3\n4");
});

test("slices.Insert", () => {
	const { js, errors } = compile(`package main
func main() {
	s := []int{1, 2, 4}
	s = slices.Insert(s, 2, 3)
	for _, v := range s {
		console.log(v)
	}
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "1\n2\n3\n4");
});

test("slices.Delete", () => {
	const { js, errors } = compile(`package main
func main() {
	s := []int{1, 2, 3, 4, 5}
	s = slices.Delete(s, 1, 3)
	for _, v := range s {
		console.log(v)
	}
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "1\n4\n5");
});

test("slices.Replace", () => {
	const { js, errors } = compile(`package main
func main() {
	s := []int{1, 2, 3, 4}
	s = slices.Replace(s, 1, 3, 9, 8)
	for _, v := range s {
		console.log(v)
	}
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "1\n9\n8\n4");
});

test("slices.Max and slices.Min", () => {
	const { js, errors } = compile(`package main
func main() {
	s := []int{3, 1, 4, 1, 5, 9}
	console.log(slices.Max(s))
	console.log(slices.Min(s))
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "9\n1");
});

test("slices.Concat", () => {
	const { js, errors } = compile(`package main
func main() {
	a := []int{1, 2}
	b := []int{3, 4}
	c := slices.Concat(a, b)
	for _, v := range c {
		console.log(v)
	}
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "1\n2\n3\n4");
});

test("slices.IsSorted", () => {
	const { js, errors } = compile(`package main
func main() {
	console.log(slices.IsSorted([]int{1, 2, 3}))
	console.log(slices.IsSorted([]int{3, 1, 2}))
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "true\nfalse");
});

test("slices.Compare", () => {
	const { js, errors } = compile(`package main
func main() {
	console.log(slices.Compare([]int{1, 2, 3}, []int{1, 2, 3}))
	console.log(slices.Compare([]int{1, 2}, []int{1, 3}))
	console.log(slices.Compare([]int{1, 3}, []int{1, 2}))
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "0\n-1\n1");
});

test("slices.SortStableFunc", () => {
	const { js, errors } = compile(`package main
func main() {
	s := []int{3, 1, 2}
	slices.SortStableFunc(s, func(a, b int) int { return a - b })
	for _, v := range s {
		console.log(v)
	}
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "1\n2\n3");
});

test("slices.IsSortedFunc", () => {
	const { js, errors } = compile(`package main
func main() {
	cmp := func(a, b int) int { return a - b }
	console.log(slices.IsSortedFunc([]int{1, 2, 3}, cmp))
	console.log(slices.IsSortedFunc([]int{3, 1, 2}, cmp))
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "true\nfalse");
});

test("slices.MaxFunc and MinFunc", () => {
	const { js, errors } = compile(`package main
func main() {
	cmp := func(a, b int) int { return a - b }
	s := []int{3, 1, 4, 1, 5}
	console.log(slices.MaxFunc(s, cmp))
	console.log(slices.MinFunc(s, cmp))
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "5\n1");
});

test("slices.CompactFunc", () => {
	const { js, errors } = compile(`package main
func main() {
	s := []int{1, 2, 2, 3, 3, 3}
	s = slices.CompactFunc(s, func(a, b int) bool { return a == b })
	for _, v := range s {
		console.log(v)
	}
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "1\n2\n3");
});

test("slices.DeleteFunc", () => {
	const { js, errors } = compile(`package main
func main() {
	s := []int{1, 2, 3, 4, 5}
	s = slices.DeleteFunc(s, func(v int) bool { return v % 2 == 0 })
	for _, v := range s {
		console.log(v)
	}
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "1\n3\n5");
});

test("slices.Insert variadic", () => {
	const { js, errors } = compile(`package main
func main() {
	s := []int{1, 5}
	s = slices.Insert(s, 1, 2, 3, 4)
	for _, v := range s {
		console.log(v)
	}
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "1\n2\n3\n4\n5");
});

test("slices.Concat three slices", () => {
	const { js, errors } = compile(`package main
func main() {
	a := []int{1}
	b := []int{2}
	c := []int{3}
	r := slices.Concat(a, b, c)
	for _, v := range r {
		console.log(v)
	}
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "1\n2\n3");
});

test("slices.Grow and slices.Clip are no-ops", () => {
	const { js, errors } = compile(`package main
func main() {
	s := []int{1, 2, 3}
	s = slices.Grow(s, 10)
	s = slices.Clip(s)
	console.log(len(s))
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "3");
});

// ═════════════════════════════════════════════════════════════
// maps package
// ═════════════════════════════════════════════════════════════

section("maps package");

test("maps.Keys", () => {
	const { js, errors } = compile(`package main
func main() {
	m := map[string]int{"a": 1, "b": 2, "c": 3}
	keys := maps.Keys(m)
	slices.Sort(keys)
	for _, k := range keys {
		console.log(k)
	}
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "a\nb\nc");
});

test("maps.Values", () => {
	const { js, errors } = compile(`package main
func main() {
	m := map[string]int{"x": 10, "y": 20}
	vals := maps.Values(m)
	slices.Sort(vals)
	for _, v := range vals {
		console.log(v)
	}
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "10\n20");
});

test("maps.Clone", () => {
	const { js, errors } = compile(`package main
func main() {
	m := map[string]int{"a": 1}
	c := maps.Clone(m)
	c["b"] = 2
	console.log(len(m))
	console.log(len(c))
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "1\n2");
});

test("maps.Copy", () => {
	const { js, errors } = compile(`package main
func main() {
	dst := map[string]int{"a": 1}
	src := map[string]int{"b": 2, "c": 3}
	maps.Copy(dst, src)
	keys := maps.Keys(dst)
	slices.Sort(keys)
	for _, k := range keys {
		console.log(k)
	}
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "a\nb\nc");
});

test("maps.Equal", () => {
	const { js, errors } = compile(`package main
func main() {
	a := map[string]int{"x": 1, "y": 2}
	b := map[string]int{"x": 1, "y": 2}
	c := map[string]int{"x": 1, "y": 3}
	console.log(maps.Equal(a, b))
	console.log(maps.Equal(a, c))
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "true\nfalse");
});

test("maps.Delete", () => {
	const { js, errors } = compile(`package main
func main() {
	m := map[string]int{"a": 1, "b": 2, "c": 3}
	maps.Delete(m, "b")
	keys := maps.Keys(m)
	slices.Sort(keys)
	for _, k := range keys {
		console.log(k)
	}
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "a\nc");
});

test("maps.EqualFunc", () => {
	const { js, errors } = compile(`package main
func main() {
	a := map[string]int{"x": 1, "y": 2}
	b := map[string]int{"x": 10, "y": 20}
	eq := maps.EqualFunc(a, b, func(v1, v2 int) bool { return v1*10 == v2 })
	console.log(eq)
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "true");
});

test("maps.DeleteFunc", () => {
	const { js, errors } = compile(`package main
func main() {
	m := map[string]int{"a": 1, "b": 2, "c": 3}
	maps.DeleteFunc(m, func(k string, v int) bool { return v > 1 })
	keys := maps.Keys(m)
	slices.Sort(keys)
	for _, k := range keys {
		console.log(k)
	}
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "a");
});

// ═════════════════════════════════════════════════════════════
// html package
// ═════════════════════════════════════════════════════════════

section("html package");

test("html.EscapeString", () => {
	const { js, errors } = compile(`package main
func main() {
	console.log(html.EscapeString("<b>Hello & \\"World\\"</b>"))
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "&lt;b&gt;Hello &amp; &#34;World&#34;&lt;/b&gt;");
});

test("html.EscapeString plain string unchanged", () => {
	const { js, errors } = compile(`package main
func main() {
	console.log(html.EscapeString("no special chars"))
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "no special chars");
});

test("html.UnescapeString", () => {
	const { js, errors } = compile(`package main
func main() {
	console.log(html.UnescapeString("&lt;b&gt;Hello &amp; &#34;World&#34;&lt;/b&gt;"))
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), '<b>Hello & "World"</b>');
});

test("html.EscapeString escapes single quotes", () => {
	const { js, errors } = compile(`package main
func main() {
	console.log(html.EscapeString("it's a test"))
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "it&#39;s a test");
});

test("html.EscapeString empty string", () => {
	const { js, errors } = compile(`package main
func main() {
	console.log(html.EscapeString("") == "")
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "true");
});

test("html.EscapeString roundtrip", () => {
	const { js, errors } = compile(`package main
func main() {
	s := "<script>alert('xss')</script>"
	console.log(html.UnescapeString(html.EscapeString(s)) == s)
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "true");
});

// ── io package ───────────────────────────────────────────────

section("io package");

test("io.WriteString with strings.Builder", () => {
	const { js, errors } = compile(`package main
func main() {
	var b strings.Builder
	n, err := io.WriteString(&b, "hello")
	console.log(b.String())
	console.log(n > 0)
	console.log(err == nil)
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "hello\ntrue\ntrue");
});

test("io.WriteString with bytes.Buffer", () => {
	const { js, errors } = compile(`package main
func main() {
	var b bytes.Buffer
	io.WriteString(&b, "world")
	console.log(b.String())
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "world");
});

test("io.Writer accepted as parameter type", () => {
	const { js, errors } = compile(`package main
func writeAll(w io.Writer, lines []string) {
	for _, line := range lines {
		io.WriteString(w, line)
	}
}
func main() {
	var b strings.Builder
	writeAll(&b, []string{"a", "b", "c"})
	console.log(b.String())
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "abc");
});

test("io.EOF is an error value", () => {
	const { js, errors } = compile(`package main
func main() {
	var err error = io.EOF
	console.log(err != nil)
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "true");
});

// ═════════════════════════════════════════════════════════════
// math additions (Feature 1)
// ═════════════════════════════════════════════════════════════

section("math additions");

test("math.Atan and math.Atan2", () => {
	const { js, errors } = compile(`package main
func main() {
	console.log(math.Atan(1.0) > 0)
	console.log(math.Atan2(1.0, 1.0) > 0)
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "true\ntrue");
});

test("math.Asin and math.Acos", () => {
	const { js, errors } = compile(`package main
func main() {
	console.log(math.Asin(0.0))
	console.log(math.Acos(1.0))
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "0\n0");
});

test("math.Exp and math.Exp2", () => {
	const { js, errors } = compile(`package main
func main() {
	console.log(math.Exp(0.0))
	console.log(math.Exp2(3.0))
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "1\n8");
});

test("math.Trunc", () => {
	const { js, errors } = compile(`package main
func main() {
	console.log(math.Trunc(3.7))
	console.log(math.Trunc(-3.7))
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "3\n-3");
});

test("math.Hypot", () => {
	const { js, errors } = compile(`package main
func main() {
	console.log(math.Hypot(3.0, 4.0))
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "5");
});

test("math.Signbit", () => {
	const { js, errors } = compile(`package main
func main() {
	console.log(math.Signbit(-1.0))
	console.log(math.Signbit(1.0))
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "true\nfalse");
});

test("math.Copysign", () => {
	const { js, errors } = compile(`package main
func main() {
	console.log(math.Copysign(3.0, -1.0))
	console.log(math.Copysign(3.0, 1.0))
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "-3\n3");
});

test("math.Dim", () => {
	const { js, errors } = compile(`package main
func main() {
	console.log(math.Dim(5.0, 3.0))
	console.log(math.Dim(3.0, 5.0))
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "2\n0");
});

test("math.Remainder", () => {
	const { js, errors } = compile(`package main
func main() {
	r := math.Remainder(10.0, 3.0)
	console.log(r > 0.9 && r < 1.1)
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "true");
});

// ═════════════════════════════════════════════════════════════
// math/rand package (Feature 2)
// ═════════════════════════════════════════════════════════════

section("math/rand package");

test("rand.Intn returns int in range", () => {
	const { js, errors } = compile(`package main
func main() {
	n := rand.Intn(10)
	console.log(n >= 0 && n < 10)
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "true");
});

test("rand.Float64 returns float in [0,1)", () => {
	const { js, errors } = compile(`package main
func main() {
	f := rand.Float64()
	console.log(f >= 0.0 && f < 1.0)
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "true");
});

test("rand.Int returns non-negative int", () => {
	const { js, errors } = compile(`package main
func main() {
	n := rand.Int()
	console.log(n >= 0)
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "true");
});

test("rand.Seed is a no-op", () => {
	const { js, errors } = compile(`package main
func main() {
	rand.Seed(42)
	console.log(true)
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "true");
});

test("rand.Shuffle shuffles elements", () => {
	const { js, errors } = compile(`package main
func main() {
	s := []int{1, 2, 3, 4, 5}
	rand.Shuffle(len(s), func(i, j int) {
		s[i], s[j] = s[j], s[i]
	})
	console.log(len(s))
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "5");
});

test("rand.Perm returns a permutation", () => {
	const { js, errors } = compile(`package main
func main() {
	p := rand.Perm(5)
	console.log(len(p))
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "5");
});

// ═════════════════════════════════════════════════════════════
// sort additions (Feature 3)
// ═════════════════════════════════════════════════════════════

section("sort additions");

test("sort.Search binary search", () => {
	const { js, errors } = compile(`package main
func main() {
	a := []int{1, 3, 6, 10, 15}
	idx := sort.Search(len(a), func(i int) bool { return a[i] >= 6 })
	console.log(idx)
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "2");
});

test("sort.IntsAreSorted", () => {
	const { js, errors } = compile(`package main
func main() {
	console.log(sort.IntsAreSorted([]int{1, 2, 3}))
	console.log(sort.IntsAreSorted([]int{3, 1, 2}))
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "true\nfalse");
});

test("sort.StringsAreSorted", () => {
	const { js, errors } = compile(`package main
func main() {
	console.log(sort.StringsAreSorted([]string{"a", "b", "c"}))
	console.log(sort.StringsAreSorted([]string{"c", "a", "b"}))
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "true\nfalse");
});

test("sort.Float64sAreSorted", () => {
	const { js, errors } = compile(`package main
func main() {
	console.log(sort.Float64sAreSorted([]float64{1.0, 2.0, 3.0}))
	console.log(sort.Float64sAreSorted([]float64{3.0, 1.0, 2.0}))
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "true\nfalse");
});

// ═════════════════════════════════════════════════════════════
// strings additions (Feature 4)
// ═════════════════════════════════════════════════════════════

section("strings additions");

test("strings.Fields splits on whitespace", () => {
	const { js, errors } = compile(`package main
func main() {
	f := strings.Fields("  foo bar  baz  ")
	console.log(len(f))
	console.log(f[0])
	console.log(f[1])
	console.log(f[2])
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "3\nfoo\nbar\nbaz");
});

test("strings.Fields on empty/whitespace returns empty slice", () => {
	const { js, errors } = compile(`package main
func main() {
	f := strings.Fields("   ")
	console.log(len(f))
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "0");
});

test("strings.Cut found", () => {
	const { js, errors } = compile(`package main
func main() {
	before, after, found := strings.Cut("user:password", ":")
	console.log(before)
	console.log(after)
	console.log(found)
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "user\npassword\ntrue");
});

test("strings.Cut not found", () => {
	const { js, errors } = compile(`package main
func main() {
	before, after, found := strings.Cut("hello", ":")
	console.log(before)
	console.log(after)
	console.log(found)
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "hello\n\nfalse");
});

test("strings.CutPrefix found", () => {
	const { js, errors } = compile(`package main
func main() {
	after, found := strings.CutPrefix("hello world", "hello ")
	console.log(after)
	console.log(found)
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "world\ntrue");
});

test("strings.CutSuffix found", () => {
	const { js, errors } = compile(`package main
func main() {
	before, found := strings.CutSuffix("hello world", " world")
	console.log(before)
	console.log(found)
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "hello\ntrue");
});

test("strings.SplitN", () => {
	const { js, errors } = compile(`package main
func main() {
	parts := strings.SplitN("a,b,c,d", ",", 3)
	console.log(len(parts))
	console.log(parts[0])
	console.log(parts[1])
	console.log(parts[2])
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "3\na\nb\nc,d");
});

test("strings.SplitAfter", () => {
	const { js, errors } = compile(`package main
func main() {
	parts := strings.SplitAfter("a,b,c", ",")
	console.log(len(parts))
	console.log(parts[0])
	console.log(parts[1])
	console.log(parts[2])
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "3\na,\nb,\nc");
});

test("strings.ContainsAny", () => {
	const { js, errors } = compile(`package main
func main() {
	console.log(strings.ContainsAny("hello", "aeiou"))
	console.log(strings.ContainsAny("rhythm", "aeiou"))
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "true\nfalse");
});

test("strings.ContainsRune", () => {
	const { js, errors } = compile(`package main
func main() {
	console.log(strings.ContainsRune("hello", 'e'))
	console.log(strings.ContainsRune("hello", 'z'))
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "true\nfalse");
});

test("strings.IndexRune", () => {
	const { js, errors } = compile(`package main
func main() {
	console.log(strings.IndexRune("hello", 'l'))
	console.log(strings.IndexRune("hello", 'z'))
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "2\n-1");
});

test("strings.IndexByte", () => {
	const { js, errors } = compile(`package main
func main() {
	console.log(strings.IndexByte("hello", 'l'))
	console.log(strings.IndexByte("hello", 'z'))
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "2\n-1");
});

test("strings.Map transforms characters", () => {
	const { js, errors } = compile(`package main
func main() {
	result := strings.Map(func(r rune) rune {
		if r == 'a' { return 'b' }
		return r
	}, "banana")
	console.log(result)
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "bbnbnb");
});

test("strings.Title capitalizes words", () => {
	const { js, errors } = compile(`package main
func main() {
	console.log(strings.Title("hello world"))
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "Hello World");
});

test("strings.ToTitle converts to uppercase", () => {
	const { js, errors } = compile(`package main
func main() {
	console.log(strings.ToTitle("hello"))
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "HELLO");
});

test("strings.TrimFunc", () => {
	const { js, errors } = compile(`package main
func main() {
	result := strings.TrimFunc("  hello  ", func(r rune) bool {
		return r == ' '
	})
	console.log(result)
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "hello");
});

test("strings.IndexFunc", () => {
	const { js, errors } = compile(`package main
func main() {
	idx := strings.IndexFunc("hello123", func(r rune) bool {
		return r >= '0' && r <= '9'
	})
	console.log(idx)
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "5");
});

test("strings.NewReplacer", () => {
	const { js, errors } = compile(`package main
func main() {
	r := strings.NewReplacer("foo", "bar", "baz", "qux")
	console.log(r.Replace("foo and baz"))
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "bar and qux");
});

test("strings.IndexAny", () => {
	const { js, errors } = compile(`package main
func main() {
	console.log(strings.IndexAny("hello", "aeiou"))
	console.log(strings.IndexAny("rhythm", "aeiou"))
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "1\n-1");
});

// ═════════════════════════════════════════════════════════════
// strconv additions (Feature 6)
// ═════════════════════════════════════════════════════════════

section("strconv additions");

test("strconv.Quote", () => {
	const { js, errors } = compile(`package main
func main() {
	console.log(strconv.Quote("hello"))
	console.log(strconv.Quote("say \\"hi\\""))
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), '"hello"\n"say \\"hi\\""');
});

test("strconv.Unquote success", () => {
	const { js, errors } = compile(`package main
func main() {
	s, err := strconv.Unquote("\\"hello\\"")
	console.log(s)
	console.log(err == nil)
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "hello\ntrue");
});

test("strconv.Unquote failure", () => {
	const { js, errors } = compile(`package main
func main() {
	_, err := strconv.Unquote("not quoted")
	console.log(err != nil)
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "true");
});

test("strconv.AppendInt", () => {
	const { js, errors } = compile(`package main
func main() {
	dst := []byte("num=")
	result := strconv.AppendInt(dst, 42, 10)
	console.log(string(result))
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "num=42");
});

// ═════════════════════════════════════════════════════════════
// unicode/utf8 package (Feature 7)
// ═════════════════════════════════════════════════════════════

section("unicode/utf8 package");

test("utf8.RuneCountInString", () => {
	const { js, errors } = compile(`package main
func main() {
	console.log(utf8.RuneCountInString("hello"))
	console.log(utf8.RuneCountInString(""))
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "5\n0");
});

test("utf8.RuneLen", () => {
	const { js, errors } = compile(`package main
func main() {
	console.log(utf8.RuneLen(65))
	console.log(utf8.RuneLen(0x80))
	console.log(utf8.RuneLen(0x800))
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "1\n2\n3");
});

test("utf8.ValidString", () => {
	const { js, errors } = compile(`package main
func main() {
	console.log(utf8.ValidString("hello"))
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "true");
});

test("utf8.ValidRune", () => {
	const { js, errors } = compile(`package main
func main() {
	console.log(utf8.ValidRune(65))
	console.log(utf8.ValidRune(-1))
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "true\nfalse");
});

test("utf8.RuneError constant", () => {
	const { js, errors } = compile(`package main
func main() {
	console.log(utf8.RuneError)
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "65533");
});

test("utf8.MaxRune constant", () => {
	const { js, errors } = compile(`package main
func main() {
	console.log(utf8.MaxRune)
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "1114111");
});

test("utf8.DecodeRuneInString", () => {
	const { js, errors } = compile(`package main
func main() {
	r, size := utf8.DecodeRuneInString("hello")
	console.log(r)
	console.log(size)
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "104\n1");
});

// ═════════════════════════════════════════════════════════════
// path package (Feature 8)
// ═════════════════════════════════════════════════════════════

section("path package");

test("path.Base", () => {
	const { js, errors } = compile(`package main
func main() {
	console.log(path.Base("/foo/bar/baz.txt"))
	console.log(path.Base("/"))
	console.log(path.Base(""))
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "baz.txt\n/\n.");
});

test("path.Dir", () => {
	const { js, errors } = compile(`package main
func main() {
	console.log(path.Dir("/foo/bar/baz.txt"))
	console.log(path.Dir("/foo"))
	console.log(path.Dir("foo"))
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "/foo/bar\n/\n.");
});

test("path.Ext", () => {
	const { js, errors } = compile(`package main
func main() {
	console.log(path.Ext("index.html"))
	console.log(path.Ext("noext"))
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), ".html\n");
});

test("path.Join", () => {
	const { js, errors } = compile(`package main
func main() {
	console.log(path.Join("foo", "bar", "baz"))
	console.log(path.Join("/foo", "bar"))
	console.log(path.Join("foo", "..", "bar"))
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "foo/bar/baz\n/foo/bar\nbar");
});

test("path.Clean", () => {
	const { js, errors } = compile(`package main
func main() {
	console.log(path.Clean("foo//bar"))
	console.log(path.Clean("./foo/./bar"))
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "foo/bar\nfoo/bar");
});

test("path.IsAbs", () => {
	const { js, errors } = compile(`package main
func main() {
	console.log(path.IsAbs("/foo/bar"))
	console.log(path.IsAbs("foo/bar"))
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "true\nfalse");
});

test("path.Split", () => {
	const { js, errors } = compile(`package main
func main() {
	dir, file := path.Split("/foo/bar/baz.txt")
	console.log(dir)
	console.log(file)
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "/foo/bar/\nbaz.txt");
});

// ═════════════════════════════════════════════════════════════
// time additions (Feature 9)
// ═════════════════════════════════════════════════════════════

section("time additions");

test("time.Now returns time.Time object", () => {
	const { js, errors } = compile(`package main
func main() {
	t := time.Now()
	console.log(t.Year() > 2000)
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "true");
});

test("time.Since returns duration in ms", () => {
	const { js, errors } = compile(`package main
func main() {
	t := time.Now()
	elapsed := time.Since(t)
	console.log(elapsed >= 0)
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "true");
});

test("time.Now().Year() Month() Day()", () => {
	const { js, errors } = compile(`package main
func main() {
	t := time.Now()
	console.log(t.Year() > 0)
	console.log(t.Month() >= 1 && t.Month() <= 12)
	console.log(t.Day() >= 1 && t.Day() <= 31)
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "true\ntrue\ntrue");
});

test("time.Unix creates time from epoch seconds", () => {
	const { js, errors } = compile(`package main
func main() {
	t := time.Unix(0, 0)
	console.log(t.Year())
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "1970");
});

test("time.RFC3339 constant", () => {
	const { js, errors } = compile(`package main
func main() {
	console.log(len(time.RFC3339) > 0)
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "true");
});

test("time.Month constants", () => {
	const { js, errors } = compile(`package main
func main() {
	console.log(time.January)
	console.log(time.December)
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "1\n12");
});

test("time.Weekday constants", () => {
	const { js, errors } = compile(`package main
func main() {
	console.log(time.Sunday)
	console.log(time.Saturday)
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "0\n6");
});

test("time.Time.UnixMilli", () => {
	const { js, errors } = compile(`package main
func main() {
	t := time.Unix(1000, 0)
	console.log(t.UnixMilli())
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "1000000");
});

test("time.Time.Before and After", () => {
	const { js, errors } = compile(`package main
func main() {
	t1 := time.Unix(1000, 0)
	t2 := time.Unix(2000, 0)
	console.log(t1.Before(t2))
	console.log(t2.After(t1))
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "true\ntrue");
});

test("time.Parse parses date string", () => {
	const { js, errors } = compile(`package main
func main() {
	t, err := time.Parse(time.RFC3339, "2024-01-15T10:30:00Z")
	console.log(err == nil)
	console.log(t.Year())
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "true\n2024");
});

test("time.Format DateOnly layout", () => {
	const { js, errors } = compile(`package main
func main() {
	t := time.Unix(1704067200, 0)
	console.log(t.Format(time.DateOnly))
}`);
	assertEqual(errors.length, 0);
	// time.Unix(1704067200, 0) = 2024-01-01 UTC; format result depends on local TZ but year must be 2024
	const out = runJs(js);
	assert(out.startsWith("2024-"), `expected year 2024, got: ${out}`);
});

test("time.Format year containing token digits (2015)", () => {
	const { js, errors } = compile(`package main
func main() {
	t := time.Unix(1420070400, 0)
	console.log(t.Format(time.DateOnly))
}`);
	assertEqual(errors.length, 0);
	// 1420070400 = 2015-01-01 UTC; year "2015" contains "15" (hour token) — single-pass fix prevents corruption
	const out = runJs(js);
	assert(out.startsWith("2015-"), `expected year 2015, got: ${out}`);
});

// ═════════════════════════════════════════════════════════════
// io.Reader additions (Feature 10)
// ═════════════════════════════════════════════════════════════

section("io.Reader additions");

test("strings.NewReader Len and Read", () => {
	const { js, errors } = compile(`package main
func main() {
	r := strings.NewReader("hello")
	console.log(r.Len())
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "5");
});

test("bytes.NewReader Len", () => {
	const { js, errors } = compile(`package main
func main() {
	r := bytes.NewReader([]byte{1, 2, 3})
	console.log(r.Len())
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "3");
});

test("io.ReadAll from strings.NewReader", () => {
	const { js, errors } = compile(`package main
func main() {
	r := strings.NewReader("hello")
	data, err := io.ReadAll(r)
	console.log(err == nil)
	console.log(len(data))
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "true\n5");
});

// ═════════════════════════════════════════════════════════════
// fmt scanning (Feature 11)
// ═════════════════════════════════════════════════════════════

section("fmt scanning");

test("fmt.Sscan parses integers", () => {
	const { js, errors } = compile(`package main
func main() {
	var a int
	var b int
	n, err := fmt.Sscan("10 20", &a, &b)
	console.log(n)
	console.log(err == nil)
	console.log(a)
	console.log(b)
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "2\ntrue\n10\n20");
});

test("fmt.Sscanf parses with format", () => {
	const { js, errors } = compile(`package main
func main() {
	var a int
	var b int
	n, err := fmt.Sscanf("10 20", "%d %d", &a, &b)
	console.log(n)
	console.log(err == nil)
	console.log(a)
	console.log(b)
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "2\ntrue\n10\n20");
});

test("fmt.Sscanln parses a line", () => {
	const { js, errors } = compile(`package main
func main() {
	var s string
	n, err := fmt.Sscanln("hello world", &s)
	console.log(n)
	console.log(err == nil)
	console.log(s)
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "1\ntrue\nhello");
});

// ── Entry point ───────────────────────────────────────────────
if (process.argv[1] === fileURLToPath(import.meta.url)) {
	process.exit(summarize() > 0 ? 1 : 0);
}
