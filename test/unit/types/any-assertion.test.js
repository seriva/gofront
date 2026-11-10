// test/unit/types/any-assertion.test.js
// A value of declared type `any` needs a type assertion before it flows into a
// concrete type, whatever the statement form.

import {
	assertErrorContains,
	compile,
	compileWasm,
	section,
	test,
} from "../helpers.js";

section("any to concrete assertions");

function errorsOn(target, src) {
	if (target === "wasm") return compileWasm(src).errors ?? [];
	return compile(src, { target }).errors ?? [];
}

const TARGETS = ["js", "both", "wasm"];

function negative(name, src, needle = "need type assertion") {
	for (const target of TARGETS) {
		test(`${name} is rejected (${target})`, () => {
			assertErrorContains(errorsOn(target, src), needle);
		});
	}
}

function positive(name, src) {
	for (const target of TARGETS) {
		test(`${name} compiles (${target})`, () => {
			const errs = errorsOn(target, src);
			if (errs.length > 0) throw new Error(`unexpected errors: ${errs}`);
		});
	}
}

// Task 2.1: plain assignment
negative(
	"a = b with b any",
	`package main
type A struct{ X int }
func main() {
	var a A
	var b any = A{1}
	a = b
	_ = a
}`,
);
positive(
	"any-to-any assignment and nil to error",
	`package main
func main() {
	var b any = 1
	var c any
	c = b
	var e error
	var x any
	_ = x
	e = nil
	_, _ = c, e
}`,
);
