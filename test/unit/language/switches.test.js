// GoFront test suite — switch statements: type-switch init statements

import {
	assert,
	assertAllTargetsOutput,
	assertEqual,
	assertErrorContains,
	assertOutput,
	compile,
	compileWasm,
	Lexer,
	Parser,
	section,
	test,
} from "../helpers.js";

function parse(source) {
	const tokens = new Lexer(source, "t.go").tokenize();
	return new Parser(tokens, "t.go", source).parse();
}

// The first `TypeSwitchStmt` under `node`.
function findTypeSwitch(node) {
	if (!node || typeof node !== "object") return null;
	if (Array.isArray(node)) {
		for (const v of node) {
			const hit = findTypeSwitch(v);
			if (hit) return hit;
		}
		return null;
	}
	if (node.kind === "TypeSwitchStmt") return node;
	for (const [k, v] of Object.entries(node)) {
		if (k.startsWith("_")) continue;
		const hit = findTypeSwitch(v);
		if (hit) return hit;
	}
	return null;
}

function errorsOn(target, src) {
	if (target === "wasm") return compileWasm(src).errors ?? [];
	return compile(src, { target }).errors ?? [];
}

const J1_1 = `package main

import "fmt"

func main() {
	var v any = 2
	switch y := 1; x := v.(type) {
	case int:
		fmt.Println(y, x)
	}
}
`;

const J1_2 = `package main

import "fmt"

func side() { fmt.Println("init") }

func main() {
	var v any = 2
	switch side(); v.(type) {
	case int:
		fmt.Println("int")
	}
}
`;

const J1_3 = `package main

import "fmt"

func main() {
	var v any = "hi"
	y := 99
	switch y := 10; x := v.(type) {
	case string:
		f := func() string { return fmt.Sprint(y, ":", x) }
		fmt.Println(f())
	}
	fmt.Println(y)
}
`;

section("Type switch init statement");

test("the type switch node carries its init statement", () => {
	const sw = findTypeSwitch(parse(J1_1));
	assertEqual(sw.init?.kind, "DefineStmt");
	assertEqual(sw.assign, "x");
});

test("a type switch without an init has a null init", () => {
	const sw = findTypeSwitch(
		parse(
			"package main\nfunc main() {\n\tvar v any\n\tswitch v.(type) {\n\t}\n}\n",
		),
	);
	assertEqual(sw.init ?? null, null);
});

for (const target of ["js", "both", "wasm"]) {
	test(`type switch init names resolve in every clause (${target})`, () => {
		assertEqual(errorsOn(target, J1_1).length, 0);
	});
}

for (const target of ["js", "both", "wasm"]) {
	test(`an unused type switch init variable is rejected (${target})`, () => {
		assertErrorContains(
			errorsOn(
				target,
				"package main\nfunc main() {\n\tvar v any = 1\n\tswitch y := 1; v.(type) {\n\tcase int:\n\t}\n}\n",
			),
			"'y' declared and not used",
		);
	});

	test(`an unused type switch init variable with a binding is rejected (${target})`, () => {
		assertErrorContains(
			errorsOn(
				target,
				"package main\nfunc main() {\n\tvar v any = 1\n\tswitch y := 1; x := v.(type) {\n\tcase int:\n\t\t_ = x\n\t}\n}\n",
			),
			"'y' declared and not used",
		);
	});
}

test("type switch init declares variables and uses them in every clause", async () => {
	await assertOutput(J1_1, "1 2\n", { targets: ["both", "js"] });
});

test("type switch init runs once before the switch expression", async () => {
	await assertOutput(J1_2, "init\nint\n", { targets: ["both", "js"] });
});

test("type switch init shadows an outer variable and closures capture it", async () => {
	await assertOutput(J1_3, "10:hi\n99\n", { targets: ["both", "js"] });
});

test("type switch init reading its own shadowed name sees the outer value", async () => {
	await assertOutput(
		`package main

import "fmt"

func main() {
	var v any = 2
	y := 5
	switch y := y + 1; v.(type) {
	case int:
		fmt.Println(y)
	}
	fmt.Println(y)
}
`,
		"6\n5\n",
		{ targets: ["both", "js"] },
	);
});

test("type switch init can use a function-local type and the default clause", async () => {
	await assertOutput(
		`package main

import "fmt"

func main() {
	type Pt struct{ X int }
	var v any = "s"
	switch p := (Pt{3}); x := v.(type) {
	case int:
		fmt.Println("int", p.X, x)
	default:
		fmt.Println("other", p.X, x)
	}
}
`,
		"other 3 s\n",
		{ targets: ["both", "js"] },
	);
});

test("type switch init in a labeled switch with break and a deref of the receiver", async () => {
	await assertOutput(
		`package main

import "fmt"

type T struct{ n int }

func (t *T) tag(v any) string {
L:
	switch k := t.n; v.(type) {
	case int:
		if k > 0 {
			break L
		}
		return "int"
	}
	return "done"
}

func main() {
	t := &T{1}
	fmt.Println(t.tag(1))
	t.n = 0
	fmt.Println(t.tag(1))
}
`,
		"done\nint\n",
		{ targets: ["both", "js"] },
	);
});

test("a type switch init value shadows a renamed function-local type", async () => {
	await assertOutput(
		`package main

import "fmt"

func a() {
	type P struct{ X int }
	fmt.Println(P{1}.X)
}

func b() {
	type P int
	var v any = 1
	switch P := 5; v.(type) {
	case int:
		fmt.Println(P)
	}
}

func main() {
	a()
	b()
}
`,
		"1\n5\n",
		{ targets: ["both", "js"] },
	);
});

test("a type switch init that reads the receiver keeps the direct method call", () => {
	const { js } = compile(
		`package main

type T struct{ n int }

func (t *T) m(v any) int {
	switch k := t.n; v.(type) {
	case int:
		return k
	}
	return 0
}

func main() {
	t := &T{1}
	println(t.m(1))
}
`,
		{ target: "js" },
	);
	assert(
		!js.includes("T.prototype.m.call"),
		"a method that dereferences its receiver in the init is not nil-safe",
	);
});

test("type switch init works on all targets", async () => {
	await assertAllTargetsOutput(J1_1, "1 2\n");
	await assertAllTargetsOutput(J1_2, "init\nint\n");
	await assertAllTargetsOutput(J1_3, "10:hi\n99\n");
});

test("type switch init declares a variable a clause closure mutates", async () => {
	await assertAllTargetsOutput(
		`package main

import "fmt"

func main() {
	var v any = 3
	switch n := 1; x := v.(type) {
	case int:
		inc := func() { n += x }
		inc()
		inc()
		fmt.Println(n)
	}
}
`,
		"7\n",
	);
});

test("type switch init inside a closure captures the enclosing variables", async () => {
	await assertAllTargetsOutput(
		`package main

import "fmt"

func main() {
	var v any = 3
	n := 10
	f := func() int {
		switch k := n; x := v.(type) {
		case int:
			return k + x
		}
		return 0
	}
	n = 20
	fmt.Println(f())
}
`,
		"23\n",
	);
});

test("type switch init without a binding, in a loop with break and continue", async () => {
	await assertAllTargetsOutput(
		`package main

import "fmt"

func main() {
	vals := []any{1, "a", 2.5, 4}
	for i := 0; i < len(vals); i++ {
		switch j := i * 10; vals[i].(type) {
		case int:
			fmt.Println("int", j)
			continue
		case string:
			fmt.Println("string", j)
		default:
			break
		}
		fmt.Println("after", i)
	}
}
`,
		"int 0\nstring 10\nafter 1\nafter 2\nint 30\n",
	);
});

test("type switch init with a multi-value define and a default-only clause", async () => {
	await assertAllTargetsOutput(
		`package main

import "fmt"

func two() (int, string) { return 4, "b" }

func main() {
	var v any = 1.5
	switch a, b := two(); x := v.(type) {
	default:
		fmt.Println(a, b, x)
	}
}
`,
		"4 b 1.5\n",
	);
});

test("an unlabeled break in a type switch clause ends only the switch", async () => {
	await assertAllTargetsOutput(
		`package main

import "fmt"

func main() {
	vals := []any{1, "a", 2.5}
	for i, v := range vals {
		switch x := v.(type) {
		case int:
			if x > 0 {
				break
			}
			fmt.Println("unreachable")
		case string:
			for j := 0; j < 3; j++ {
				if j == 1 {
					break
				}
				fmt.Println("inner", j)
			}
			switch {
			case x == "a":
				break
			}
			fmt.Println("string done")
		default:
			func() {
				switch v.(type) {
				case float64:
					break
				}
				fmt.Println("lit done")
			}()
		}
		fmt.Println("after", i)
	}
}
`,
		"after 0\ninner 0\nstring done\nafter 1\nlit done\nafter 2\n",
	);
});

test("an unlabeled break in a type switch inside a range-over-func body ends only the switch", async () => {
	await assertAllTargetsOutput(
		`package main

import "fmt"

func seq(yield func(any) bool) {
	for _, v := range []any{1, "a", 3} {
		if !yield(v) {
			return
		}
	}
}

func main() {
	for v := range seq {
		switch v.(type) {
		case int:
			break
		}
		fmt.Println("after", v)
	}
}
`,
		"after 1\nafter a\nafter 3\n",
	);
});

test("type switch init in escapes, comma-ok reads, loops and generics", async () => {
	await assertAllTargetsOutput(
		`package main

import "fmt"

type Box[T any] struct{ v T }

func (b *Box[T]) kind(a any) string {
	switch c := b.v; a.(type) {
	case T:
		return fmt.Sprint("T ", c)
	}
	return "other"
}

func gen[T any](x T, a any) string {
	switch y := x; t := a.(type) {
	case int:
		return fmt.Sprint("int ", y, t)
	case T:
		return fmt.Sprint("T ", y, t)
	}
	return "none"
}

func main() {
	n := 1
	var v any = "s"
	switch p := &n; v.(type) {
	case string:
		*p = 5
	}
	fmt.Println(n)

	m := map[string]int{"a": 7}
	switch k, ok := m["a"]; w := v.(type) {
	case string:
		fmt.Println(k, ok, w)
	}

	var fs []func() int
	for i := 0; i < 2; i++ {
		switch j := i * 2; v.(type) {
		case string:
			fs = append(fs, func() int { j++; return j })
		}
	}
	fmt.Println(fs[0](), fs[0](), fs[1]())

	fmt.Println(gen(1, 2), gen("a", "b"), gen(1.5, "z"))
	b := &Box[int]{4}
	fmt.Println(b.kind(3), b.kind("q"))
}
`,
		"5\n7 true s\n1 2 3\nint 1 2 T ab none\nT 4 other\n",
	);
});
