// GoFront test suite — regexp (Go-source, js packages only)
//
// The package is backed by the host's RegExp engine, so patterns use
// JavaScript syntax and indexes count UTF-16 units.

import {
	assertEqual,
	assertErrorContains,
	compile,
	runJs,
	section,
	test,
} from "../helpers.js";

function run(body, prelude = "") {
	const { js, errors } = compile(`package main
${prelude}
func main() {
${body}
}`);
	assertEqual(errors.length, 0);
	return runJs(js);
}

section("regexp (Go-source)");

test("imports are optional and explicit imports work", () => {
	assertEqual(run(`console.log(regexp.MustCompile("a+").String())`), "a+");
	const { js, errors } = compile(`package main

import "regexp"

func main() { console.log(regexp.MustCompile("b").MatchString("abc")) }
`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "true");
});

test("MatchString, FindString and FindStringIndex", () => {
	assertEqual(
		run(`
	re := regexp.MustCompile("[0-9]+")
	console.log(re.MatchString("a1"), re.MatchString("a"))
	console.log(re.FindString("abc123def45"), re.FindString("none") == "")
	idx := re.FindStringIndex("abc123")
	console.log(len(idx), idx[0], idx[1])
	console.log(re.FindStringIndex("abc") == nil)`),
		"true false\n123 true\n2 3 6\ntrue",
	);
});

test("FindAllString honours the limit and -1 means all", () => {
	assertEqual(
		run(`
	re := regexp.MustCompile("[0-9]+")
	console.log(re.FindAllString("1 22 333 4444", -1))
	console.log(re.FindAllString("1 22 333 4444", 2))
	console.log(len(re.FindAllString("1 22", 0)), len(re.FindAllString("none", -1)))`),
		"1,22,333,4444\n1,22\n0 0",
	);
});

test("submatches: FindStringSubmatch and FindAllStringSubmatch", () => {
	assertEqual(
		run(`
	re := regexp.MustCompile("([a-z]+)([0-9]+)?")
	m := re.FindStringSubmatch("ab12")
	console.log(len(m), m[0], m[1], m[2])
	m = re.FindStringSubmatch("cd")
	console.log(len(m), m[0], m[1], m[2] == "")
	console.log(len(re.FindStringSubmatch("--")))
	all := re.FindAllStringSubmatch("ab12 cd34", -1)
	console.log(len(all), all[1][1], all[1][2])
	console.log(len(re.FindAllStringSubmatch("ab12 cd34", 1)))`),
		"3 ab12 ab 12\n3 cd cd true\n0\n2 cd 34\n1",
	);
});

test("ReplaceAllString expands $1, ReplaceAllLiteralString does not", () => {
	assertEqual(
		run(`
	re := regexp.MustCompile("([a-z]+)([0-9]+)")
	console.log(re.ReplaceAllString("ab12 cd34", "$2$1"))
	console.log(re.ReplaceAllString("ab12", "[$&]"))
	console.log(re.ReplaceAllLiteralString("ab12 cd34", "$1"))
	console.log(regexp.MustCompile("[aeiou]").ReplaceAllString("hello world", "*"))`),
		"12ab 34cd\n[ab12]\n$1 $1\nh*ll* w*rld",
	);
});

test("ReplaceAllStringFunc", () => {
	assertEqual(
		run(`
	re := regexp.MustCompile("[0-9]+")
	console.log(re.ReplaceAllStringFunc("a1b22", func(s string) string { return "<" + s + ">" }))`),
		"a<1>b<22>",
	);
});

test("Split limits", () => {
	assertEqual(
		run(`
	re := regexp.MustCompile("[,;]+")
	console.log(re.Split("a,b;;c,d", -1))
	console.log(re.Split("a,b;;c,d", 2))
	console.log(len(re.Split("a,b", 0)), len(re.Split("abc", -1)))`),
		"a,b,c,d\na,b\n0 1",
	);
});

test("String, Compile errors and MustCompile panics", () => {
	assertEqual(
		run(`
	re, err := regexp.Compile("(?i)hello")
	console.log(err == nil, re.String(), re.MatchString("HELLO"), re.MatchString("world"))
	bad, err := regexp.Compile("(")
	console.log(bad == nil, err != nil)
	defer func() { console.log(recover() != nil) }()
	regexp.MustCompile("(")`),
		"true (?i)hello true false\ntrue true\ntrue",
	);
});

test("package-level MatchString and QuoteMeta", () => {
	assertEqual(
		run(`
	ok, err := regexp.MatchString("^a.c$", "abc")
	console.log(ok, err == nil)
	_, err = regexp.MatchString("[", "x")
	console.log(err != nil)
	console.log(regexp.QuoteMeta("a.b+c?[d]{e}(f)|^$\\\\"))`),
		"true true\ntrue\na\\.b\\+c\\?\\[d\\]\\{e\\}\\(f\\)\\|\\^\\$\\\\",
	);
});

test("a wasm package importing regexp is a diagnostic", () => {
	const { errors } = compile(
		`package main

import "regexp"

func F() bool { return regexp.MustCompile("a").MatchString("a") }
`,
		{ target: "wasm" },
	);
	assertErrorContains(
		errors,
		"package 'regexp' is only available in js packages",
	);
});

test("no match returns nil slices", () => {
	assertEqual(
		run(
			`re := regexp.MustCompile("a")
	console.log(re.FindStringSubmatch("b") == nil, re.FindAllString("b", -1) == nil, re.FindAllStringSubmatch("b", -1) == nil, re.FindStringIndex("b") == nil)
	console.log(len(re.FindAllString("aa", -1)), re.FindStringSubmatch("a") == nil)`,
		),
		"true true true true\n2 false",
	);
});
