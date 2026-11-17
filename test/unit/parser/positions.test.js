// GoFront test suite — every expression node carries its leftmost token position

import {
	assertEqual,
	assertErrorContains,
	compile,
	Lexer,
	Parser,
	section,
	summarize,
	test,
} from "../helpers.js";

function parse(source) {
	const tokens = new Lexer(source, "t.go").tokenize();
	return new Parser(tokens, "t.go", source).parse();
}

// Every node of `kind` under `node`, in source order.
function collect(node, kind, out = []) {
	if (!node || typeof node !== "object") return out;
	if (Array.isArray(node)) {
		for (const v of node) collect(v, kind, out);
		return out;
	}
	if (node.kind === kind) out.push(node);
	for (const [k, v] of Object.entries(node)) {
		if (k.startsWith("_")) continue;
		collect(v, kind, out);
	}
	return out;
}

const SAMPLE = `package main

type P struct{ X, Y int }

func use(a ...any) {}

func main() {
	s := []int{1, 2, 3}
	m := map[string]P{"a": {1, 2}}
	var v any = s
	n := s[0] + s[1]*2
	use(n, s[1:2], m["a"].X, v.(int))
	p := P{X: 1, Y: 2}
	use(p)
	go1 := (n + 1) * 2
	use(go1)
}
`;

const ast = parse(SAMPLE);
const lines = SAMPLE.split("\n");

// The 1-based line:col of the first occurrence of `text` at or after `fromLine`.
function locate(text, fromLine = 1) {
	for (let i = fromLine - 1; i < lines.length; i++) {
		const col = lines[i].indexOf(text);
		if (col >= 0) return { line: i + 1, col: col + 1 };
	}
	throw new Error(`"${text}" not found`);
}

function assertAt(node, text, fromLine) {
	const want = locate(text, fromLine);
	assertEqual(
		`${node._line}:${node._col}`,
		`${want.line}:${want.col}`,
		`${node.kind} position`,
	);
}

section("Parser — expression positions");

test("BinaryExpr starts at its left operand", () => {
	const bins = collect(ast, "BinaryExpr");
	assertEqual(bins.length, 4);
	// `s[0] + s[1]*2` and the nested `s[1]*2`
	assertAt(bins[0], "s[0] + s[1]*2", 11);
	assertAt(bins[1], "s[1]*2", 11);
});

test("a parenthesised left operand starts at the parenthesis", () => {
	const bins = collect(ast, "BinaryExpr");
	assertAt(bins[2], "(n + 1) * 2");
	// the parenthesised `n + 1` starts at `n`
	assertAt(bins[3], "n + 1", 15);
});

test("CallExpr starts at its callee", () => {
	const calls = collect(ast, "CallExpr");
	assertEqual(calls.length, 3);
	assertAt(calls[0], "use(n, s[1:2]", 12);
});

test("SelectorExpr, IndexExpr, SliceExpr, TypeAssertExpr start at their operand", () => {
	assertAt(collect(ast, "SelectorExpr")[0], 'm["a"].X');
	const idx = collect(ast, "IndexExpr");
	assertAt(idx[0], "s[0]", 11);
	assertAt(collect(ast, "SliceExpr")[0], "s[1:2]");
	assertAt(collect(ast, "TypeAssertExpr")[0], "v.(int)");
});

test("CompositeLit starts at its type, or at the brace when the type is elided", () => {
	const lits = collect(ast, "CompositeLit");
	assertAt(lits[0], "[]int{1, 2, 3}");
	assertAt(lits[1], "map[string]P{");
	// the elided `{1, 2}` inside the map literal
	assertAt(lits[2], "{1, 2}");
	assertAt(lits[3], "P{X: 1, Y: 2}");
});

test("KeyValueExpr starts at its key", () => {
	const kvs = collect(ast, "KeyValueExpr");
	assertAt(kvs[0], '"a": {1, 2}');
	assertAt(kvs[1], "X: 1");
});

test("AwaitExpr starts at the await keyword", () => {
	const src =
		"package main\nasync func f() int { return 1 }\nasync func g() int {\n\treturn await f()\n}\n";
	const a = collect(parse(src), "AwaitExpr")[0];
	assertEqual(`${a._line}:${a._col}`, "4:9");
});

test("TypeExpr call arguments start at their type", () => {
	const src =
		"package main\nfunc main() {\n\ts := make([]int, 3)\n\t_ = s\n}\n";
	const t = collect(parse(src), "TypeExpr")[0];
	assertEqual(`${t._line}:${t._col}`, "3:12");
});

section("Type errors — positions on expression diagnostics");

test("a binary type error reports the line of the expression", () => {
	const { errors } = compile(
		'package main\n\nfunc main() {\n\ta := 1\n\n\t_ = "s" + a\n}\n',
	);
	assertErrorContains(errors, "at line 6:");
});

test("a call argument count error reports the line of the call", () => {
	const { errors } = compile(
		"package main\n\nfunc f(a, b int) {}\n\nfunc main() {\n\n\tf(1)\n}\n",
	);
	assertErrorContains(errors, "at line 7:");
});

test("an unknown field reports the line of the selector", () => {
	const { errors } = compile(
		"package main\n\ntype S struct{ A int }\n\nfunc main() {\n\ts := S{}\n\n\t_ = s.B\n}\n",
	);
	assertErrorContains(errors, "at line 8:");
});

section("Type errors — unused variables point at the declaration");

test("an unused := variable reports its own position", () => {
	const { errors } = compile("package main\n\nfunc main() {\n\tx := 1\n}\n");
	assertErrorContains(errors, "'x' declared and not used");
	assertErrorContains(errors, "at line 4:2");
});

test("an unused var declaration reports the name, not the func line", () => {
	const { errors } = compile(
		"package main\n\nfunc main() {\n\tvar a, b int\n\t_ = a\n}\n",
	);
	assertErrorContains(errors, "'b' declared and not used");
	assertErrorContains(errors, "at line 4:9");
});

test("an unused variable nested in a block reports its own line", () => {
	const { errors } = compile(
		"package main\n\nfunc main() {\n\tif true {\n\t\tfor i := 0; i < 1; i++ {\n\t\t\ty := 2\n\t\t}\n\t}\n}\n",
	);
	assertErrorContains(errors, "at line 6:4");
});

summarize();
