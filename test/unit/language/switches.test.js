// GoFront test suite — switch statements: type-switch init statements

import {
	assertEqual,
	assertErrorContains,
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
