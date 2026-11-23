// GoFront test suite — cached ASTs survive consecutive builds untouched

import { resolve } from "node:path";
import {
	clearParseCache,
	compileDir,
	freezeParseCache,
} from "../../../src/compiler.js";
import { lower } from "../../../src/lower/index.js";
import { cloneAst } from "../../../src/lower/walk.js";
import { TypeChecker } from "../../../src/typechecker/index.js";
import * as typeTable from "../../../src/typechecker/types.js";
import {
	assert,
	assertEqual,
	Lexer,
	Parser,
	section,
	test,
	withTempDir,
} from "../helpers.js";

section("compiler.js — parse cache ASTs are never mutated");

// Runs `fn` with every AST the parse cache stores deep-frozen, so a write to a
// cached baseline throws instead of leaking into the next build.
function withFrozenParseCache(fn) {
	clearParseCache();
	freezeParseCache(true);
	try {
		return fn();
	} finally {
		freezeParseCache(false);
		clearParseCache();
	}
}

// Compiles `dir` twice on a frozen parse cache. Returns both results.
function compileTwice(dir, options = {}) {
	return withFrozenParseCache(() => [
		compileDir(dir, options),
		compileDir(dir, options),
	]);
}

test("function-local types compile twice on frozen cached ASTs", () => {
	withTempDir(
		{
			"main.go": `package main
type Box struct{ n int }
func make1() int {
	type local struct{ a int }
	v := local{a: 1}
	return v.a
}
func make2() int {
	type local struct{ b string }
	v := local{b: "x"}
	return len(v.b)
}
func main() { println(make1(), make2(), Box{n: 1}.n) }
`,
		},
		(dir) => {
			const [a, b] = compileTwice(dir);
			assert(a.js.includes("make1"), "compiled");
			assertEqual(b.js, a.js);
			assert(/class local__L1\b/.test(a.js), "the first local type is __L1");
		},
	);
});

test("local type names are unique across packages and repeat across builds", () => {
	withTempDir(
		{
			"main.go": `package main
import "./u"
func f1() int { type local struct{ a int }; v := local{a: 1}; return v.a }
func f2() int { type local struct{ b int }; v := local{b: 1}; return v.b }
func main() { println(f1(), f2(), u.G()) }
`,
			"u/u.go": `package u
func g1() int { type local struct{ a int }; v := local{a: 1}; return v.a }
func g2() int { type local struct{ b int }; v := local{b: 1}; return v.b }
func G() int { return g1() + g2() }
`,
		},
		(dir) => {
			const [a, b] = compileTwice(dir);
			assertEqual(b.js, a.js);
			const classes = [...a.js.matchAll(/class (local__L\d+)\b/g)].map(
				(m) => m[1],
			);
			assertEqual(classes.length, 4);
			assertEqual(new Set(classes).size, 4);
		},
	);
});

test("a type named like a predeclared type gets a stable name", () => {
	withTempDir(
		{
			"main.go": `package main
type int32 struct{ n int }
func main() { println(int32{n: 1}.n) }
`,
		},
		(dir) => {
			const [a, b] = compileTwice(dir);
			assertEqual(b.js, a.js);
			assert(/\bint32__L1\b/.test(a.js), "renamed from 1");
		},
	);
});

test("colliding type names across packages compile twice on frozen ASTs", () => {
	withTempDir(
		{
			"main.go": `package main
import "./util"
type Pt struct{ X int }
func main() { p := Pt{X: 1}; q := util.NewPt(); println(p.X, q.X) }
`,
			"util/util.go": `package util
type Pt struct{ X int }
func NewPt() Pt { return Pt{X: 2} }
`,
		},
		(dir) => {
			const [a, b] = compileTwice(dir);
			assertEqual(b.js, a.js);
			assert(a.js.includes("Pt$$"), "the colliding type is renamed");
		},
	);
});

test("folded array lengths and reserved identifiers on frozen ASTs", () => {
	withTempDir(
		{
			"main.go": `package main
const N = 2 + 1
func main() {
	var arr [N]int
	class := 1
	arr[0] = class
	println(arr[0], len(arr))
}
`,
		},
		(dir) => {
			const [a, b] = compileTwice(dir);
			assertEqual(b.js, a.js);
			assert(!/\bclass\b\s*=/.test(a.js), "reserved identifier is renamed");
		},
	);
});

test("defer and forwarded multi-value calls on frozen ASTs", () => {
	withTempDir(
		{
			"main.go": `package main
func f() (int, int) { return 1, 2 }
func g(a, b int) int { return a + b }
func run() int {
	defer func() { recover() }()
	return g(f())
}
func main() { println(run()) }
`,
		},
		(dir) => {
			const [a, b] = compileTwice(dir);
			assertEqual(b.js, a.js);
		},
	);
});

test("strict-mode slice indexing on frozen ASTs", () => {
	withTempDir(
		{
			"main.go": `package main
func sum(xs []int) int {
	t := 0
	for i := 0; i < len(xs); i++ { t += xs[i] }
	return t
}
func main() { println(sum([]int{1, 2, 3})) }
`,
		},
		(dir) => {
			const [a, b] = compileTwice(dir, { strict: true });
			assertEqual(b.js, a.js);
		},
	);
});

test("go:embed directives compile twice on frozen ASTs", () => {
	withTempDir(
		{
			"main.go": `package main
import _ "embed"
//go:embed note.txt
var note string
func main() { println(note) }
`,
			"note.txt": "hello embed",
		},
		(dir) => {
			const [a, b] = compileTwice(dir);
			assert(a.js.includes("hello embed"), "embedded text");
			assertEqual(b.js, a.js);
		},
	);
});

test("templ components compile twice on frozen ASTs", () => {
	withTempDir(
		{
			"main.go": `package main
func main() { gom.Mount("#app", Row([]string{"a", "b"})) }
`,
			"row.templ": `package main

templ Row(items []string) {
	<ul class={ "list" }>
		for _, it := range items {
			<li class={ it }>{ it }</li>
		}
	</ul>
}
`,
		},
		(dir) => {
			const [a, b] = compileTwice(dir);
			assert(a.js.includes("Row"), "templ compiled");
			assertEqual(b.js, a.js);
		},
	);
});

test("a cached build equals a build from a cold cache", () => {
	withTempDir(
		{
			"main.go": `package main
import "./util"
type Pt struct{ X int }
const N = 2
func main() { var a [N]int; class := 1; a[0] = class; println(a[0], util.NewPt().X, Pt{}.X) }
`,
			"util/util.go": `package util
type Pt struct{ X int }
func NewPt() Pt { return Pt{X: 2} }
`,
		},
		(dir) => {
			clearParseCache();
			const cold = compileDir(dir);
			const warm = compileDir(dir);
			clearParseCache();
			assertEqual(warm.js, cold.js);
		},
	);
});

section("lower/walk.js — cloneAst");

test("cloneAst copies nodes, shares side references and keeps identity", () => {
	const shared = { kind: "int" };
	const leaf = { kind: "Ident", name: "x", _type: shared };
	const ast = { kind: "Block", stmts: [leaf, leaf], _type: shared };
	const copy = cloneAst(ast);
	assert(copy !== ast && copy.stmts !== ast.stmts, "fresh shells");
	assert(copy.stmts[0] !== leaf, "children are cloned");
	assert(copy.stmts[0] === copy.stmts[1], "shared children stay shared");
	assert(copy._type === shared && copy.stmts[0]._type === shared, "side refs");
	copy.stmts[0].name = "y";
	assertEqual(leaf.name, "x");
});

test("cloneAst can copy parse-time side structures too", () => {
	const directive = { patterns: ["a"], _embedFiles: undefined };
	const ast = { kind: "Spec", _embeds: [directive], _line: 3 };
	const copy = cloneAst(ast, { cloneSide: true });
	assert(copy._embeds[0] !== directive, "side structure is cloned");
	assertEqual(copy._line, 3);
	copy._embeds[0]._embedFiles = [];
	assertEqual(directive._embedFiles, undefined);
});

test("cloneAst copies class instances and shares opaque built-ins", () => {
	class Tok {
		constructor(v) {
			this.v = v;
		}
	}
	const err = new Error("x");
	const ast = { kind: "N", tokens: [new Tok(1)], err };
	const copy = cloneAst(ast);
	assert(copy.tokens[0] !== ast.tokens[0], "token is a fresh object");
	assert(copy.tokens[0] instanceof Tok, "prototype is kept");
	assert(copy.err === err, "errors are shared");
});

test("cloneAst keeps non-enumerable properties hidden", () => {
	const ast = { kind: "TemplFor" };
	Object.defineProperty(ast, "forStmt", {
		value: { kind: "ForStmt" },
		enumerable: false,
		writable: true,
		configurable: true,
	});
	const copy = cloneAst(ast);
	assertEqual(Object.keys(copy).join(), "kind");
	assertEqual(copy.forStmt.kind, "ForStmt");
	assert(copy.forStmt !== ast.forStmt, "hidden child is cloned");
});

section("lowering and the checker leave shared state alone");

// The `_iterStateName` of every range-over-func loop after lowering `source`.
function iterStateNames(source) {
	const ast = new Parser(
		new Lexer(source, "main.go").tokenize(),
		"main.go",
		source,
	).parse();
	const checker = new TypeChecker();
	checker.target = "wasm";
	checker.pkgName = "main";
	checker.check(ast);
	lower([ast], checker);
	const names = [];
	const walk = (n) => {
		if (!n || typeof n !== "object") return;
		if (Array.isArray(n)) return n.forEach(walk);
		if (n._iterStateName) names.push(n._iterStateName);
		for (const k of Object.keys(n)) if (k[0] !== "_") walk(n[k]);
	};
	walk(ast);
	return names;
}

test("range-over-func state variables are numbered from 1 per lowering", () => {
	const src = `package main
func seq(n int) func(yield func(int) bool) {
	return func(yield func(int) bool) { for i := 0; i < n; i++ { if !yield(i) { return } } }
}
func sum() int {
	t := 0
	for v := range seq(3) { t += v }
	for v := range seq(2) { t += v }
	return t
}
func main() { println(sum()) }
`;
	const first = iterStateNames(src);
	assertEqual(first.join(), "__iterState$1,__iterState$2");
	assertEqual(iterStateNames(src).join(), first.join());
});

function deepFreeze(node, seen = new Set()) {
	if (!node || typeof node !== "object" || seen.has(node)) return;
	seen.add(node);
	Object.freeze(node);
	for (const k of Object.getOwnPropertyNames(node)) deepFreeze(node[k], seen);
}

test("a frozen exported generic type is instantiated by two checkers", () => {
	withTempDir(
		{
			"a/a.go": `package a
type Box[T any] struct{ V T }
func New[T any](v T) Box[T] { return Box[T]{V: v} }
func (b Box[T]) Get() T { return b.V }
`,
		},
		(dir) => {
			const dep = compileDir(resolve(dir, "a"), { isDependency: true });
			const box = dep.exportedTypes.get("Box");
			deepFreeze(box._generic);
			const main = `package main
import "./a"
func main() {
	var b a.Box[int] = a.New(1)
	var s a.Box[string] = a.Box[string]{V: "x"}
	println(b.Get(), s.Get())
}
`;
			for (let round = 0; round < 2; round++) {
				const ast = new Parser(
					new Lexer(main, "main.go").tokenize(),
					"main.go",
					main,
				).parse();
				const checker = new TypeChecker();
				checker.target = "js";
				checker.pkgName = "main";
				checker.addPackageNamespace(
					"a",
					dep.exportedSymbols,
					dep.exportedTypes,
					dep.target,
					dep.exportedConsts,
					dep.exportedKinds,
					"main.go",
					dep.reachedTypes,
				);
				checker.trackImport("a", { _line: 2 }, "main.go", main);
				assertEqual(checker.check(ast).length, 0);
			}
			const keys = Object.keys(box._generic);
			for (const k of ["_instances", "_building", "_buildSizes"])
				assert(!keys.includes(k), `${k} stays off the descriptor`);
			assert(!("_cycleReported" in box._generic), "no cycle flag");
			assert(!("_syncDepth" in box._generic), "no sync depth");
		},
	);
});

test("an instantiation cycle is still reported once", () => {
	withTempDir(
		{
			"main.go": `package main
type T[X any] struct{ n *T[[]X] }
func main() { var t T[int]; _ = t }
`,
		},
		(dir) => {
			let message = "";
			try {
				compileDir(dir);
			} catch (e) {
				message = e.message;
			}
			assert(message.includes("instantiation cycle"), message);
			assertEqual(message.split("instantiation cycle").length - 1, 1);
		},
	);
});

section("stdlib units — frozen after their build");

// Everything the type table exports (`error`, `any`, the untyped kinds, …):
// objects every compile in the process shares, so a freeze must leave them.
function sharedTypeObjects() {
	const shared = new Set();
	const visit = (v) => {
		if (!v || typeof v !== "object" || shared.has(v)) return;
		shared.add(v);
		if (v instanceof Map) for (const e of v.values()) visit(e);
		else if (v instanceof Set) for (const e of v) visit(e);
		else for (const k of Object.keys(v)) visit(v[k]);
	};
	for (const v of Object.values(typeTable)) visit(v);
	return shared;
}

const SHARED_TYPE_OBJECTS = sharedTypeObjects();

// Freezes `value` and everything it holds, entries of maps and sets included.
// Class instances (a checker's `Scope`, built-in classes) are live checker
// state and stay as they are, like the shared type objects.
function deepFreezeAll(value, seen = new Set(SHARED_TYPE_OBJECTS)) {
	if (!value || typeof value !== "object" || seen.has(value)) return;
	seen.add(value);
	const proto = Object.getPrototypeOf(value);
	const plain =
		proto === Object.prototype ||
		proto === Array.prototype ||
		proto === Map.prototype ||
		proto === Set.prototype ||
		proto === null;
	if (!plain) return;
	Object.freeze(value);
	if (value instanceof Map)
		for (const [k, v] of value) {
			deepFreezeAll(k, seen);
			deepFreezeAll(v, seen);
		}
	else if (value instanceof Set) for (const v of value) deepFreezeAll(v, seen);
	for (const k of Object.getOwnPropertyNames(value))
		deepFreezeAll(Object.getOwnPropertyDescriptor(value, k).value, seen);
}

// Freezes what a stored Go-source stdlib unit hands to its importers.
function freezeStdlibUnits(stdlibCache) {
	for (const pkg of stdlibCache.values()) {
		if (!pkg || pkg instanceof Error) continue;
		deepFreezeAll(pkg.unit.programs);
		deepFreezeAll(pkg.exportedTypes);
		deepFreezeAll(pkg.namespace);
	}
}

const STD_FIRST = `
import (
	"fmt"
	"sort"
	"sync"
)
func main() {
	var mu sync.Mutex
	mu.Lock()
	mu.Unlock()
	xs := []int{3, 1, 2}
	sort.Ints(xs)
	fmt.Println(xs)
}
`;

const STD_SECOND = `
import (
	"encoding/json"
	"fmt"
	"slices"
	"sort"
	"sync"
)
type Doc struct{ N int }
func main() {
	var mu sync.RWMutex
	mu.RLock()
	mu.RUnlock()
	ss := []string{"b", "a"}
	sort.Strings(ss)
	slices.Sort(ss)
	b, _ := json.Marshal(Doc{N: 1})
	fmt.Println(ss, string(b))
}
`;

// Builds `source` as package main of `target`; the wasm bytes are returned as
// hex so two builds compare with assertEqual.
function buildStd(source, target, options) {
	return withTempDir(
		{ "main.go": `//gofront:target ${target}\npackage main\n${source}` },
		(dir) => {
			const res = compileDir(dir, options);
			return {
				js: res.js,
				wasm: res.wasm ? Buffer.from(res.wasm).toString("hex") : "",
			};
		},
	);
}

for (const target of ["js", "both"]) {
	test(`frozen stdlib units serve later builds (${target})`, () => {
		const stdlibCache = new Map();
		buildStd(STD_FIRST, target, { stdlibCache });
		freezeStdlibUnits(stdlibCache);
		const warm = buildStd(STD_SECOND, target, { stdlibCache });
		freezeStdlibUnits(stdlibCache);
		const again = buildStd(STD_SECOND, target, { stdlibCache });
		assertEqual(again.js, warm.js);
		assertEqual(again.wasm, warm.wasm);
		const cold = buildStd(STD_SECOND, target, { stdlibCache: new Map() });
		assertEqual(warm.js, cold.js);
		assertEqual(warm.wasm, cold.wasm);
		assert(warm.js.includes("RLock"), "the RWMutex code is emitted");
	});
}

test("wasm stdlib units are never mutated by a later link", () => {
	const stdlibCache = new Map();
	buildStd(STD_FIRST, "wasm", { stdlibCache });
	freezeStdlibUnits(stdlibCache);
	const warm = buildStd(STD_SECOND, "wasm", { stdlibCache });
	const cold = buildStd(STD_SECOND, "wasm", { stdlibCache: new Map() });
	assertEqual(warm.wasm, cold.wasm);
	assert(warm.wasm.length > 0, "a module was linked");
});

test("stdlib JS is memoized for an unchanged reached set", () => {
	const stdlibCache = new Map();
	const cacheStats = {};
	const first = buildStd(STD_FIRST, "js", { stdlibCache, cacheStats });
	assert((cacheStats.stdlibJsMisses ?? 0) > 0, "the first build emits");
	assertEqual(cacheStats.stdlibJsHits ?? 0, 0);
	const misses = cacheStats.stdlibJsMisses;
	const second = buildStd(STD_FIRST, "js", { stdlibCache, cacheStats });
	assertEqual(second.js, first.js);
	assertEqual(cacheStats.stdlibJsMisses, misses);
	assertEqual(cacheStats.stdlibJsHits, misses);
	buildStd(STD_SECOND, "js", { stdlibCache, cacheStats });
	assert(cacheStats.stdlibJsMisses > misses, "a larger reached set emits");
});
