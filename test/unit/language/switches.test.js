// GoFront test suite — switch statements: type-switch init statements

import {
	assert,
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

for (const target of ["js", "both"]) {
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
