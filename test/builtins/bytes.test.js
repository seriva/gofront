// GoFront test suite — bytes standard library shim

import {
	assertEqual,
	assertErrorContains,
	compile,
	runJs,
	section,
	test,
} from "../helpers.js";

section("bytes package");

test("bytes.Contains", () => {
	const { js, errors } = compile(`package main
func main() {
	b := []byte("hello world")
	console.log(bytes.Contains(b, []byte("world")))
	console.log(bytes.Contains(b, []byte("xyz")))
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "true\nfalse");
});

test("bytes.HasPrefix", () => {
	const { js, errors } = compile(`package main
func main() {
	b := []byte("hello")
	console.log(bytes.HasPrefix(b, []byte("hel")))
	console.log(bytes.HasPrefix(b, []byte("xyz")))
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "true\nfalse");
});

test("bytes.HasSuffix", () => {
	const { js, errors } = compile(`package main
func main() {
	b := []byte("hello")
	console.log(bytes.HasSuffix(b, []byte("llo")))
	console.log(bytes.HasSuffix(b, []byte("xyz")))
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "true\nfalse");
});

test("bytes.Index", () => {
	const { js, errors } = compile(`package main
func main() {
	b := []byte("hello")
	console.log(bytes.Index(b, []byte("ll")))
	console.log(bytes.Index(b, []byte("xyz")))
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "2\n-1");
});

test("bytes.Join", () => {
	const { js, errors } = compile(`package main
func main() {
	parts := [][]byte{[]byte("a"), []byte("b"), []byte("c")}
	result := bytes.Join(parts, []byte("-"))
	console.log(string(result))
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "a-b-c");
});

test("bytes.Split", () => {
	const { js, errors } = compile(`package main
func main() {
	b := []byte("a,b,c")
	parts := bytes.Split(b, []byte(","))
	console.log(len(parts))
	console.log(string(parts[0]))
	console.log(string(parts[1]))
	console.log(string(parts[2]))
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "3\na\nb\nc");
});

test("bytes.Replace", () => {
	const { js, errors } = compile(`package main
func main() {
	b := []byte("aaa")
	result := bytes.Replace(b, []byte("a"), []byte("b"), 2)
	console.log(string(result))
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "bba");
});

test("bytes.ToUpper", () => {
	const { js, errors } = compile(`package main
func main() {
	b := []byte("hello")
	console.log(string(bytes.ToUpper(b)))
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "HELLO");
});

test("bytes.ToLower", () => {
	const { js, errors } = compile(`package main
func main() {
	b := []byte("HELLO")
	console.log(string(bytes.ToLower(b)))
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "hello");
});

test("bytes.TrimSpace", () => {
	const { js, errors } = compile(`package main
func main() {
	b := []byte("  hello  ")
	console.log(string(bytes.TrimSpace(b)))
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "hello");
});

test("bytes.Equal", () => {
	const { js, errors } = compile(`package main
func main() {
	a := []byte("hello")
	b := []byte("hello")
	c := []byte("world")
	console.log(bytes.Equal(a, b))
	console.log(bytes.Equal(a, c))
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "true\nfalse");
});

test("bytes.Count", () => {
	const { js, errors } = compile(`package main
func main() {
	b := []byte("banana")
	console.log(bytes.Count(b, []byte("a")))
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "3");
});

test("bytes.Repeat", () => {
	const { js, errors } = compile(`package main
func main() {
	b := []byte("ab")
	console.log(string(bytes.Repeat(b, 3)))
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "ababab");
});

test("error: bytes.Contains with wrong arg types", () => {
	const { errors } = compile(`package main
func main() {
	bytes.Contains("hello", "world")
}`);
	assertErrorContains(errors, "Cannot assign");
});
