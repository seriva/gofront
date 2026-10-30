// GoFront test suite — generic instantiation lookahead in call arguments

import { fileURLToPath } from "node:url";
import {
	assertEqual,
	compile,
	Lexer,
	Parser,
	runJs,
	section,
	summarize,
	test,
} from "../helpers.js";

function parse(source) {
	const tokens = new Lexer(source, "t.go").tokenize();
	return new Parser(tokens, "t.go", source).parse();
}

// First CallExpr to `name` found anywhere under `node`.
function findCall(node, name) {
	if (!node || typeof node !== "object") return null;
	if (node.kind === "CallExpr" && node.func?.name === name) return node;
	for (const v of Object.values(node)) {
		const hit = findCall(v, name);
		if (hit) return hit;
	}
	return null;
}

section("Parser — index expressions inside call arguments");

test("nested selector indexing in an argument is an IndexExpr", () => {
	const ast = parse(`package main
type E struct{ Index int }
type S struct{ Meshes []int; Entries []E }
func Add(x int) {}
func Test(s S, i int) { Add(s.Meshes[s.Entries[i].Index]) }
`);
	const call = findCall(ast, "Add");
	assertEqual(call.args[0].kind, "IndexExpr");
	assertEqual(call.args[0].index.kind, "SelectorExpr");
});

test("nested selector indexing compiles and runs", () => {
	const { js, errors } = compile(`package main
type E struct{ Index int }
type S struct{ Meshes []int; Entries []E }
func Add(x int) int { return x + 1 }
func Test(s S, i int) int { return Add(s.Meshes[s.Entries[i].Index]) }
func main() {
	s := S{Meshes: []int{10, 20}, Entries: []E{{Index: 1}}}
	println(Test(s, 0))
}
`);
	assertEqual(errors.map((e) => e.message).join("\n"), "");
	assertEqual(runJs(js), "21");
});

test("explicit instantiation arguments still parse", () => {
	const ast = parse(`package main
func Id[T any](x T) T { return x }
func Test() { f(Id[int], Id[[]int](nil)) }
`);
	assertEqual(findCall(ast, "f").args[0].kind, "InstantiationExpr");
});

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	process.exit((await summarize()) > 0 ? 1 : 0);
}
