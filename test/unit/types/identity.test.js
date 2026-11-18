// GoFront test suite — structural type identity (`identical`)
//
// Types come from small programs run through the checker, so they have the
// shapes the checker builds: package-level `var` names give the types to
// compare.

import { Lexer } from "../../../src/lexer/lexer.js";
import { renameLocalTypes } from "../../../src/link/type-names.js";
import { Parser } from "../../../src/parser/index.js";
import { TypeChecker } from "../../../src/typechecker/index.js";
import {
	ANY,
	DECLARED_ANY,
	identical,
	TAINTED_ANY,
} from "../../../src/typechecker/types.js";
import { assert, section, summarize, test } from "../helpers.js";

function check(source) {
	const tokens = new Lexer(source, "test.go").tokenize();
	const ast = new Parser(tokens, "test.go", source).parse();
	renameLocalTypes([ast]);
	const checker = new TypeChecker();
	checker.check(ast);
	if (checker.errors?.length > 0)
		throw new Error(checker.errors.map((e) => e.message ?? e).join("\n"));
	return { checker, ast };
}

// The declared types of package-level vars `a` and `b` in `decls`.
function pair(decls, ta, tb) {
	const { checker } = check(
		`package main\n${decls}\nvar a ${ta}\nvar b ${tb}\nfunc main() {}\n`,
	);
	return [checker.globals.get("a"), checker.globals.get("b")];
}

function differs(name, decls, ta, tb) {
	test(`identical: ${name} differ`, () => {
		const [a, b] = pair(decls, ta, tb);
		assert(!identical(a, b), `${ta} and ${tb} must not be identical`);
		assert(!identical(b, a), `${tb} and ${ta} must not be identical`);
	});
}

function same(name, decls, ta, tb) {
	test(`identical: ${name} match`, () => {
		const [a, b] = pair(decls, ta, tb);
		assert(identical(a, b), `${ta} and ${tb} must be identical`);
		assert(identical(b, a), `${tb} and ${ta} must be identical`);
	});
}

section("Type identity — differing types");

differs("struct field names", "", "struct{ X int }", "struct{ Y int }");
differs("struct field types", "", "struct{ X int }", "struct{ X string }");
differs(
	"struct tags",
	"",
	'struct{ X int `json:"a"` }',
	'struct{ X int `json:"b"` }',
);
differs(
	"struct tag against no tag",
	"",
	'struct{ X int `json:"a"` }',
	"struct{ X int }",
);
differs(
	"struct field order",
	"",
	"struct{ X int; Y int }",
	"struct{ Y int; X int }",
);
differs(
	"embedded field against a named field",
	"type E struct{}",
	"struct{ E }",
	"struct{ E E }",
);
differs("struct field counts", "", "struct{ X int }", "struct{ X, Y int }");
differs(
	"interface method sets",
	"",
	"interface{ Foo() int }",
	"interface{ Bar() int }",
);
differs(
	"interface method signatures",
	"",
	"interface{ Foo() int }",
	"interface{ Foo() string }",
);
differs("func params", "", "func(int)", "func(string)");
differs("func results", "", "func() int", "func() string");
differs("func result counts", "", "func() int", "func() (int, int)");
differs("func variadic flags", "", "func(...int)", "func([]int)");
differs("array lengths", "", "[2]int", "[3]int");
differs("slice and array", "", "[]int", "[2]int");
differs("map value types", "", "map[string]int", "map[string]string");
differs("pointer bases", "", "*int", "*string");
differs(
	"anonymous structs with different element types",
	"",
	"[]struct{ X int }",
	"[]struct{ Y string }",
);
differs(
	"two named struct types with the same fields",
	"type A struct{ X int }\ntype B struct{ X int }",
	"A",
	"B",
);
differs("named type and its underlying type", "type A int", "A", "int");
differs(
	"instances with different type arguments",
	"type Box[V any] struct{ v V }",
	"Box[int]",
	"Box[string]",
);
differs(
	"a named type and an anonymous struct",
	"type A struct{ X int }",
	"A",
	"struct{ X int }",
);

test("identical: a shadowing local type and the package type differ", () => {
	const { ast } = check(
		`package main
type T struct{ A int }
var x T
func main() {
	_ = x
	type T struct{ B string }
	var y T
	_ = y
}
`,
	);
	const found = {};
	const walk = (n) => {
		if (!n || typeof n !== "object") return;
		if (Array.isArray(n)) return n.forEach(walk);
		if (n.kind === "Ident" && (n.name === "x" || n.name === "y") && n._type)
			found[n.name] = n._type;
		for (const k in n) if (!k.startsWith("_")) walk(n[k]);
	};
	walk(ast);
	assert(found.x && found.y, "both types were resolved");
	assert(found.x !== found.y, "the two T are distinct objects");
	assert(!identical(found.x, found.y), "outer T and inner T__L1 differ");
	assert(identical(found.x, found.x), "T is identical to itself");
});

test("identical: the same type name in two packages differs", () => {
	const decl = "type P struct{ X int }\nvar a P\n";
	const one = check(`package main\n${decl}func main() {}\n`);
	const two = check(`package main\n${decl}func main() {}\n`);
	const p1 = one.checker.globals.get("a");
	const p2 = two.checker.globals.get("a");
	assert(!identical(p1, p2), "two packages' P differ");
});

test("identical: one declaration checked twice gives identical types", () => {
	const src =
		"package main\ntype P struct{ X int }\ntype G[V any] struct{ v V }\nvar a P\nvar g G[int]\nfunc main() {}\n";
	const ast = new Parser(
		new Lexer(src, "t.go").tokenize(),
		"t.go",
		src,
	).parse();
	const one = new TypeChecker();
	one.check(ast);
	const two = new TypeChecker();
	two.check(ast);
	const of = (c, n) => c.globals.get(n);
	assert(of(one, "a") !== of(two, "a"), "two checks build two objects");
	assert(identical(of(one, "a"), of(two, "a")), "P is one declaration");
	assert(identical(of(one, "g"), of(two, "g")), "G[int] is one instance");
});

section("Type identity — identical types");

same("recursive struct type with itself", "type L struct{ next *L }", "L", "L");
same("byte and uint8", "", "byte", "uint8");
same("rune and int32", "", "rune", "int32");
same("empty interface and any", "", "interface{}", "any");
same("equal anonymous structs", "", "struct{ X int }", "struct{ X int }");
same(
	"equal anonymous structs with tags",
	"",
	'struct{ X int `json:"a"` }',
	'struct{ X int `json:"a"` }',
);
same(
	"interfaces with the same methods in another order",
	"",
	"interface{ Foo() int; Bar() string }",
	"interface{ Bar() string; Foo() int }",
);
same(
	"funcs that differ only in parameter names",
	"",
	"func(x int)",
	"func(y int)",
);
same("equal arrays", "", "[3]int", "[3]int");
same("equal maps of slices", "", "map[string][]int", "map[string][]int");
same(
	"equal instances of a generic type",
	"type Box[V any] struct{ v V }",
	"Box[int]",
	"Box[int]",
);
same(
	"anonymous recursive-free nesting",
	"",
	"[]struct{ P *struct{ X int } }",
	"[]struct{ P *struct{ X int } }",
);

test("identical: any in all its spellings", () => {
	assert(identical(DECLARED_ANY, ANY));
	assert(identical(ANY, TAINTED_ANY));
	assert(identical(DECLARED_ANY, TAINTED_ANY));
	const [a, b] = pair("", "interface{}", "any");
	assert(identical(a, DECLARED_ANY) && identical(b, ANY));
});

test("identical: a type is identical to itself and untyped nothing is void", () => {
	const [a] = pair("type R struct{ r *R }", "R", "R");
	assert(identical(a, a));
	assert(identical(undefined, undefined));
	assert(!identical(a, undefined));
});

test("a chain of defined types type-checks in len, range, index, conversion and append", () => {
	check(`package main
type A B
type B C
type C []int
func main() {
	s := A{1, 2}
	_ = len(s)
	for range s {
	}
	_ = s[0]
	_ = []int(s)
	s = append(s, 3)
}
`);
});

summarize();
