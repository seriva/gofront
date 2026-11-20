// test/unit/types/switch-cases.test.js
// Switch case checks: an untyped-bool tag still checks its cases, and a
// switch on a non-nilable tag (tagless or not) rejects `case nil`.

import {
	assertAllTargetsOutput,
	assertEqual,
	assertErrorContains,
	compile,
	compileWasm,
	section,
	test,
} from "../helpers.js";

section("Switch case checks");

function errorsOn(target, src) {
	if (target === "wasm") return compileWasm(src).errors ?? [];
	return compile(src, { target }).errors ?? [];
}

const NEGATIVE = [
	[
		"switch true { case 5: }",
		"package main\nfunc main() {\n\tswitch true {\n\tcase 5:\n\t}\n}",
		"cannot convert 5 (untyped int constant) to type bool",
	],
	[
		"switch { case nil: }",
		"package main\nfunc main() {\n\tswitch {\n\tcase nil:\n\t}\n}",
		"cannot convert nil to type bool",
	],
	[
		"switch true { case nil: }",
		"package main\nfunc main() {\n\tswitch true {\n\tcase nil:\n\t}\n}",
		"cannot convert nil to type bool",
	],
	[
		"switch n { case nil: } on int",
		"package main\nfunc main() {\n\tn := 1\n\tswitch n {\n\tcase nil:\n\t}\n}",
		"cannot convert nil to type int",
	],
];

for (const [name, src, want] of NEGATIVE) {
	for (const target of ["js", "both", "wasm"]) {
		test(`${name} is rejected (${target})`, () => {
			assertErrorContains(errorsOn(target, src), want);
		});
	}
}

test("untyped-bool tag and tagless cases stay valid on all targets", async () => {
	await assertAllTargetsOutput(
		`package main

import "fmt"

func main() {
	x := 3
	switch true {
	case 1 > 0:
		fmt.Println("a")
	}
	switch false {
	case x > 5:
		fmt.Println("b")
	}
	switch {
	case x > 0:
		fmt.Println("c")
	}
}
`,
		"a\nb\nc\n",
	);
});

test("case nil on nilable tags stays valid on all targets", async () => {
	await assertAllTargetsOutput(
		`package main

import "fmt"

func main() {
	var e error
	switch e {
	case nil:
		fmt.Println("e nil")
	}
	var p *int
	switch p {
	case nil:
		fmt.Println("p nil")
	}
	var s []int
	switch s {
	case nil:
		fmt.Println("s nil")
	}
	var f func()
	switch f {
	case nil:
		fmt.Println("f nil")
	}
}
`,
		"e nil\np nil\ns nil\nf nil\n",
	);
});

test("case nil matches a nil map tag on all targets", async () => {
	await assertAllTargetsOutput(
		`package main

import "fmt"

type MM map[string]int

func main() {
	var m map[string]int
	switch m {
	case nil:
		fmt.Println("m nil")
	}
	m2 := map[string]int{}
	switch m2 {
	case nil:
		fmt.Println("m2 nil")
	default:
		fmt.Println("non-nil")
	}
	var mm MM
	switch mm {
	case nil:
		fmt.Println("mm nil")
	default:
		fmt.Println("mm non-nil")
	}
}
`,
		"m nil\nnon-nil\nmm nil\n",
	);
});

// R24: a type-switch binding is used when any clause uses it.
for (const [name, body] of [
	["one clause", "case int:\n\t\t_ = x\n\tcase string:"],
	["default clause", "case int:\n\tdefault:\n\t\t_ = x"],
	["a closure", "case int:\n\t\tfunc() { _ = x }()"],
	[
		"a nested block shadow",
		"case int:\n\t\t{\n\t\t\tx := 2\n\t\t\t_ = x\n\t\t}\n\tcase string:\n\t\t_ = x",
	],
]) {
	test(`R24 type switch binding used in ${name}`, () => {
		const src = `package main\nfunc main() {\n\tvar v any = 1\n\tswitch x := v.(type) {\n\t${body}\n\t}\n}`;
		for (const target of ["js", "both", "wasm"])
			assertEqual(errorsOn(target, src).length, 0);
	});
}

test("R24 unused type switch binding without clauses", () => {
	const src =
		"package main\nfunc main() {\n\tvar v any = 1\n\tswitch x := v.(type) {\n\t}\n}";
	for (const target of ["js", "both", "wasm"])
		assertErrorContains(errorsOn(target, src), "'x' declared and not used");
});
