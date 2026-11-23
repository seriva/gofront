// Differential fuzzer: generates random, well-typed Go programs, runs each
// with real Go (`go run`) and with GoFront on the `js`, `both` and `wasm`
// targets, and reports every case whose output differs. A failing case is
// shrunk to a small repro and written to the output directory.
//
//   node test/fuzz/difffuzz.js [--mode order|arith] [--seed N] [--batches N]
//     [--cases N] [--stmts N] [--targets js,both,wasm] [--out DIR]
//     [--no-reduce] [--anon-embed]
//   node test/fuzz/difffuzz.js --replay file.go [--targets js,both,wasm]
//     runs one program with Go and each target and prints every output
//   node test/fuzz/difffuzz.js --case SEED:N [--mode ..] [--stmts N] [--anon-embed]
//     regenerates case N of batch seed SEED and replays it; every finding
//     header prints the exact command
//   node test/fuzz/difffuzz.js --print [--case SEED:N | --seed N --cases N]
//     prints the generated program without running it (needs no Go)
//   node test/fuzz/difffuzz.js --self-test
//     checks the generator without Go (run by the unit tests)
//
// Modes:
//   order  evaluation order and value semantics: side-effecting calls in
//          index, key and right-hand operands, compound and multi-assignment,
//          comma-ok, for-post, struct/array copies, embedded structs, pointer
//          aliasing, append aliasing, range copies, defer.
//   arith  sized integer arithmetic (int8..uint64): wrapping, conversions,
//          shifts, truncated division. `js` packages do not wrap narrow
//          integers by design, so this mode defaults to `both,wasm`.
//
// The generator only produces programs whose output the Go spec fixes. Go
// leaves the order of a plain variable read relative to a call in the same
// statement unspecified (`a + f()` where `f` changes `a`), and gc and GoFront
// can differ there. So every statement that calls a closure must not name any
// variable the closure changes (see ALIAS_GROUPS and stmtConflicts).
//
// Known, documented differences the generator avoids:
//   - Go's `int`/`uint` are 64-bit; in JS output they are exact only to 2^53.
//     `order` cases whose Go output holds a number beyond that are skipped,
//     and `arith` never converts to `int`/`uint`.
//   - wasm/both only take the address of a local int, so `p` points at `a`
//     or `b` only.
//   - `v` is an anonymous struct with an embedded field only with
//     --anon-embed (wasm emits invalid modules for those today, which would
//     hide every other wasm result in the batch).

import { execFileSync } from "node:child_process";
import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { compileProgram, firstLine } from "./gofront-run.js";

// ── CLI ──────────────────────────────────────────────────────

const args = process.argv.slice(2);
function opt(name, def) {
	const i = args.indexOf(`--${name}`);
	return i >= 0 ? args[i + 1] : def;
}
const MODE = opt("mode", "order");
const SEED = Number(opt("seed", Date.now() % 1e9));
const BATCHES = Number(opt("batches", 10));
const CASES = Number(opt("cases", 40));
const STMTS = Number(opt("stmts", 12));
const TARGETS = opt("targets", MODE === "arith" ? "both,wasm" : "js,both,wasm")
	.split(",")
	.filter(Boolean);
const OUT = resolve(opt("out", ".probes/fuzz"));
const REDUCE = !args.includes("--no-reduce");
const ANON_EMBED = args.includes("--anon-embed");
const REPLAY = opt("replay", null);
const CASE = opt("case", null);
const SELF_TEST = args.includes("--self-test");
const PRINT = args.includes("--print");
if (!["order", "arith"].includes(MODE)) {
	console.error(`unknown --mode ${MODE}`);
	process.exit(2);
}

// ── PRNG (xorshift32) ────────────────────────────────────────

function rng(seed) {
	let s = seed >>> 0 || 1;
	const next = () => {
		s ^= s << 13;
		s >>>= 0;
		s ^= s >>> 17;
		s ^= s << 5;
		s >>>= 0;
		return s / 4294967296;
	};
	return {
		int: (lo, hi) => lo + Math.floor(next() * (hi - lo + 1)),
		pick: (xs) => xs[Math.floor(next() * xs.length)],
		chance: (p) => next() < p,
	};
}

function weighted(r, kinds) {
	const total = kinds.reduce((t, [w]) => t + w, 0);
	let x = r.int(0, total - 1);
	for (const [w, f] of kinds) {
		if (x < w) return f();
		x -= w;
	}
	throw new Error("unreachable");
}

// Variables that may alias each other (or share storage) map to one group.
// `p` points at `a` or `b`; `ps` at `s`, `s2` or an element of `ss`; `ys`
// shares `xs`'s array.
const ALIAS_GROUPS = {
	a: "ab",
	b: "ab",
	p: "ab",
	i: "i",
	j: "j",
	xs: "xs",
	ys: "xs",
	arr: "arr",
	m: "m",
	s: "S",
	s2: "S",
	ps: "S",
	ss: "S",
	v: "v",
	w: "w",
};

function groupsNamed(text) {
	const groups = new Set();
	for (const m of text.matchAll(/(?<![.\w"])[a-z]\w*/g))
		if (Object.hasOwn(ALIAS_GROUPS, m[0])) groups.add(ALIAS_GROUPS[m[0]]);
	return groups;
}

const CALL = /(?<![.\w])(f\d+|ks|kf)\(/g;

// Closures called by `text` that exist in `funcs`.
function calledFuncs(text, funcs) {
	return [...text.matchAll(CALL)]
		.map((m) => funcs.find((f) => f.name === m[1]))
		.filter(Boolean);
}

// Groups a closure may change, including those changed by the closures its
// body calls, however deep.
function closureGroups(fn, funcs, seen = new Set()) {
	seen.add(fn.name);
	const text = fn.muts.join(";");
	const groups = groupsNamed(text);
	for (const callee of calledFuncs(text, funcs))
		if (!seen.has(callee.name))
			for (const g of closureGroups(callee, funcs, seen)) groups.add(g);
	return groups;
}

// True when `stmt` calls a closure that changes a group the statement also
// names: Go leaves the result of such a statement unspecified. The check
// follows calls made inside closure bodies.
function stmtConflicts(stmt, funcs) {
	const named = groupsNamed(stmt);
	for (const fn of calledFuncs(stmt, funcs))
		for (const g of closureGroups(fn, funcs)) if (named.has(g)) return true;
	return false;
}

// A case is { decls, funcs, stmts, prints }. `decls` ends with a line that
// uses every variable; `funcs` are side-effecting closures whose mutation
// lists the reducer can shrink; `stmts` and `prints` shrink too.

// ── Generator: order mode ────────────────────────────────────

const ORDER_PRELUDE = `type P struct{ M int }

type S struct {
	A [2]int
	N int
	P
}

type V struct {
	P
	K int
}
`;

function genOrderCase(r, nStmts) {
	const lit = () => String(r.int(-9, 9));
	const nFuncs = 3;
	const ie = (d) => `(${expr(d)})&1`;
	const ke = (d) => (r.chance(0.4) ? `ks(${expr(d)})` : r.pick(['"x"', '"y"']));

	// Int lvalues; each is also readable as an expression.
	const lvalue = (d) =>
		r.pick([
			() => "a",
			() => "b",
			() => "i",
			() => "j",
			() => `xs[${ie(d)}]`,
			() => `ys[${ie(d)}]`,
			() => `arr[${ie(d)}]`,
			() => `m[${ke(d)}]`,
			() => "*p",
			() => "s.N",
			() => "s.M",
			() => "s.P.M",
			() => `s.A[${ie(d)}]`,
			() => "ps.N",
			() => `ps.A[${ie(d)}]`,
			() => "v.M",
			() => "v.K",
			() => "w.P.M",
			() => `ss[${ie(d)}].N`,
			() => `ss[${ie(d)}].A[${ie(d)}]`,
		])();

	function expr(d) {
		if (d <= 0) return r.chance(0.5) ? lit() : lvalue(0);
		return r.pick([
			lit,
			() => lvalue(d - 1),
			() => lvalue(d - 1),
			() => `f${r.int(0, nFuncs - 1)}(${expr(d - 1)})`,
			() => `f${r.int(0, nFuncs - 1)}(${expr(d - 1)})`,
			() => "len(xs)",
			() =>
				`(${expr(d - 1)} ${r.pick(["+", "-", "^", "&", "|"])} ${expr(d - 1)})`,
			() => `(${expr(d - 1)} * ${r.pick(["2", "3", "-1"])})`,
			() =>
				`(${expr(d - 1)} ${r.pick(["/", "%"])} ${r.pick(["2", "3", "-2", "5"])})`,
			() => `-(${expr(d - 1)})`,
		])();
	}

	const ptrTarget = () => r.pick(["&a", "&b"]);
	// `calls` is false inside `ks`, which must not call itself.
	const sptrTarget = (calls = true) =>
		r.pick(["&s", "&s2", `&ss[${calls ? ie(0) : r.int(0, 1)}]`]);

	const mutation = (n, calls = true) =>
		r.pick([
			() => `a = ${n}`,
			() => `i = ${n}`,
			() => "j++",
			() => `xs[${r.int(0, 1)}] = ${n}`,
			() => `xs = []int{${n}, ${n} + 1}`,
			() => `arr[${r.int(0, 1)}] = ${n}`,
			() => `m["x"] = ${n}`,
			() => `*p = ${n}`,
			() => `p = ${ptrTarget()}`,
			() => `s.N = ${n}`,
			() => `s.A[${r.int(0, 1)}] = ${n}`,
			() => `s.M = ${n}`,
			() => `ps = ${sptrTarget(calls)}`,
			() => `v.M = ${n}`,
			() => `s = S{N: ${n}}`,
		])();

	const decls = [
		"var tr []int",
		`a, b, i, j := ${lit()}, ${lit()}, ${lit()}, ${lit()}`,
		`xs := []int{${lit()}, ${lit()}}`,
		"ys := xs",
		`arr := [2]int{${lit()}, ${lit()}}`,
		`m := map[string]int{"x": ${lit()}, "y": ${lit()}}`,
		"p := &a",
		`s := S{A: [2]int{${lit()}, ${lit()}}, N: ${lit()}, P: P{M: ${lit()}}}`,
		"s2 := s",
		"ps := &s",
		ANON_EMBED
			? `v := struct {\n\t\tP\n\t\tK int\n\t}{P{${lit()}}, ${lit()}}`
			: `v := V{P{${lit()}}, ${lit()}}`,
		"w := v",
		"var ss [2]S",
		"var ok bool",
		"_, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _ = tr, a, b, i, j, xs, ys, arr, m, p, s, s2, ps, v, w, ss, ok",
	];

	// Closures are declared in order, so a body only calls earlier ones: `ks`
	// comes first and `f0`-`f2` may call it.
	const funcs = [
		{
			name: "ks",
			muts: [mutation("n", false)],
			render: (ms) =>
				`ks := func(n int) string { ${["tr = append(tr, 10+n&1)", ...ms].join("; ")}; if n&1 == 0 { return "x" }; return "y" }`,
		},
	];
	for (let k = 0; k < nFuncs; k++) {
		const muts = [];
		const nm = r.int(1, 2);
		for (let q = 0; q < nm; q++) {
			// A mutation that reads what a closure it calls changes is
			// unspecified, like a statement: fall back to a call-free one.
			let mut = mutation(r.pick(["n", lit()]));
			if (stmtConflicts(mut, funcs))
				mut = mutation(r.pick(["n", lit()]), false);
			muts.push(mut);
		}
		funcs.push({
			name: `f${k}`,
			muts,
			render: (ms) =>
				`f${k} := func(n int) int { ${[`tr = append(tr, ${k})`, ...ms].join("; ")}; return n + ${k} }`,
		});
	}

	function stmt(depth) {
		const e = () => expr(2);
		const inner = (dflt) => (depth > 0 ? stmt(depth - 1) : dflt);
		return weighted(r, [
			[4, () => `${lvalue(1)} = ${e()}`],
			[
				4,
				() => `${lvalue(1)} ${r.pick(["+=", "-=", "^=", "|=", "&="])} ${e()}`,
			],
			[1, () => `${lvalue(1)} *= ${r.pick(["2", "3", "-1"])}`],
			[1, () => `${lvalue(1)}${r.pick(["++", "--"])}`],
			[3, () => `${lvalue(1)}, ${lvalue(1)} = ${e()}, ${e()}`],
			[
				1,
				() =>
					`${lvalue(1)}, ${lvalue(1)}, ${lvalue(1)} = ${e()}, ${e()}, ${e()}`,
			],
			[
				1,
				() => {
					const x = lvalue(0);
					const y = lvalue(0);
					return `${x}, ${y} = ${y}, ${x}`;
				},
			],
			[2, () => `${lvalue(1)}, ok = m[${ke(1)}]`],
			[
				1,
				() =>
					`if t, ok2 := m[${ke(1)}]; ok2 { ${lvalue(1)} += t } else { ${lvalue(1)} = t + 1 }`,
			],
			[1, () => `f${r.int(0, nFuncs - 1)}(${e()})`],
			[1, () => `p = ${ptrTarget()}`],
			[1, () => `p, *p = ${ptrTarget()}, ${e()}`],
			[1, () => `ps = ${sptrTarget()}`],
			[1, () => `ps, ps.N = ${sptrTarget()}, ${e()}`],
			[
				2,
				() =>
					r.pick([
						"s2 = s",
						"s = *ps",
						"*ps = s2",
						`ss[${ie(1)}] = s`,
						`s = ss[${ie(1)}]`,
						"w = v",
						"v = w",
						"v.P = s.P",
						"s.P = w.P",
						`arr = [2]int{${e()}, ${e()}}`,
						"s.A = arr",
						"arr = s.A",
					]),
			],
			[
				1,
				() =>
					`${r.pick(["s2", "*ps", `ss[${ie(1)}]`])}, ${lvalue(1)} = s, ${e()}`,
			],
			[1, () => `xs = append(xs[:1], ${e()})`],
			[1, () => r.pick(["ys = xs", "xs = ys", "xs = []int{xs[1], xs[0]}"])],
			[
				1,
				() =>
					`for k := 0; k < 2; ${lvalue(1)}, k = ${e()}, k+1 { ${inner("j++")} }`,
			],
			[
				1,
				() =>
					`for idx, val := range ${r.pick(["xs", "arr", "s.A"])} { ${lvalue(1)} += val*2 + idx; ${inner("j++")} }`,
			],
			[
				1,
				() => `if ${e()} > ${e()} { ${inner("a++")} } else { ${inner("b++")} }`,
			],
			[
				1,
				() =>
					`func() { defer func() { ${lvalue(1)} = ${e()} }(); ${inner("a++")} }()`,
			],
		]);
	}

	const stmts = [];
	for (let k = 0; k < nStmts; k++) {
		let st = null;
		for (let tries = 0; tries < 20 && st === null; tries++) {
			const cand = stmt(1);
			if (!stmtConflicts(cand, funcs)) st = cand;
		}
		stmts.push(st ?? "a++");
	}
	const prints = [
		"tr",
		"a",
		"b",
		"i",
		"j",
		"xs",
		"ys",
		"arr",
		"m",
		"*p",
		"p == &a",
		"s",
		"s2",
		"*ps",
		"ps == &s",
		"v",
		"w",
		"ss",
		"ok",
	];
	return { decls, funcs, stmts, prints };
}

// ── Generator: arith mode ────────────────────────────────────

const INT_TYPES = {
	int8: [-128n, 127n],
	int16: [-32768n, 32767n],
	int32: [-2147483648n, 2147483647n],
	int64: [-(2n ** 63n), 2n ** 63n - 1n],
	uint8: [0n, 255n],
	uint16: [0n, 65535n],
	uint32: [0n, 4294967295n],
	uint64: [0n, 2n ** 64n - 1n],
};
const TYPE_NAMES = Object.keys(INT_TYPES);

function genArithCase(r, nStmts) {
	const vars = [];
	const decls = [];
	const literal = (t) => {
		const [lo, hi] = INT_TYPES[t];
		if (r.chance(0.35))
			return r.pick([lo, hi, 0n, 1n, lo + 1n, hi - 1n]).toString();
		// Clamp by hand: Math.min/max do not accept BigInt.
		let v = BigInt(r.int(-100, 100));
		if (v < lo) v = lo;
		if (v > hi) v = hi;
		return v.toString();
	};
	for (let k = 0; k < 6; k++) {
		const t = r.pick(TYPE_NAMES);
		vars.push({ name: `x${k}`, t });
		decls.push(`var x${k} ${t} = ${literal(t)}`);
	}
	const varOf = (t) => vars.filter((v) => v.t === t);

	// An expression of type t. Constants appear only as the right operand of
	// a binary op next to a non-constant, so no constant subexpression can
	// overflow its type.
	function expr(t, d) {
		const own = varOf(t);
		const leaf = () =>
			own.length && r.chance(0.7)
				? r.pick(own).name
				: `${t}(${r.pick(vars).name})`;
		if (d <= 0) return leaf();
		return r.pick([
			leaf,
			() => {
				const op = r.pick(["+", "-", "*", "&", "|", "^", "&^"]);
				const b = r.chance(0.4) ? literal(t) : expr(t, d - 1);
				return `(${expr(t, d - 1)} ${op} ${b})`;
			},
			() => {
				// uint8, not uint: uint is 53-bit in JS output.
				const n = r.chance(0.5)
					? String(r.int(0, 70))
					: `(uint8(${r.pick(vars).name}) & 63)`;
				return `(${expr(t, d - 1)} ${r.pick(["<<", ">>"])} ${n})`;
			},
			() => {
				const signed = INT_TYPES[t][0] < 0n;
				const dv = r.pick(
					signed ? ["-1", "2", "3", "-7", "16"] : ["1", "2", "3", "7", "16"],
				);
				return `(${expr(t, d - 1)} ${r.pick(["/", "%"])} ${dv})`;
			},
			() => `(${r.pick(["-", "^"])}${expr(t, d - 1)})`,
			() => `${t}(${expr(r.pick(TYPE_NAMES), d - 1)})`,
		])();
	}

	const stmts = [];
	for (let k = 0; k < nStmts; k++) {
		const v = r.pick(vars);
		const op = r.pick(["=", "+=", "-=", "*=", "<<=", ">>=", "^="]);
		if (op === "<<=" || op === ">>=")
			stmts.push(`${v.name} ${op} ${r.int(0, 66)}`);
		else stmts.push(`${v.name} ${op} ${expr(v.t, 2)}`);
	}
	decls.push(
		`${vars.map(() => "_").join(", ")} = ${vars.map((v) => v.name).join(", ")}`,
	);
	return { decls, funcs: [], stmts, prints: vars.map((v) => v.name) };
}

// ── Program assembly ─────────────────────────────────────────

function caseLines(c) {
	return [
		...c.decls.slice(0, -1),
		...c.funcs.map((f) => f.render(f.muts)),
		...(c.funcs.length
			? [`_ = ${c.funcs.map((f) => `${f.name} != nil`).join(" && ")}`]
			: []),
		c.decls.at(-1),
		...c.stmts,
		`fmt.Println(${c.prints.join(", ")})`,
	];
}

function renderProgram(cases) {
	const out = ["package main", "", 'import "fmt"', ""];
	if (MODE === "order") out.push(ORDER_PRELUDE);
	cases.forEach((c, n) => {
		out.push(`func case${n}() {`);
		for (const l of caseLines(c)) out.push(`\t${l}`);
		out.push("}", "");
	});
	out.push("func main() {");
	cases.forEach((_, n) => {
		out.push(`\tfmt.Println("#${n}")`, `\tcase${n}()`);
	});
	out.push("}", "");
	return out.join("\n");
}

const GENERATORS = {
	order: genOrderCase,
	arith: genArithCase,
};

function splitCases(text) {
	const res = new Map();
	let cur = null;
	for (const line of text.split("\n")) {
		const m = /^#(\d+)$/.exec(line);
		if (m) {
			cur = Number(m[1]);
			res.set(cur, []);
		} else if (cur !== null) res.get(cur).push(line);
	}
	return new Map([...res].map(([k, v]) => [k, v.join("\n").trimEnd()]));
}

// ── Runners ──────────────────────────────────────────────────

const work = mkdtempSync(join(tmpdir(), "gofront-fuzz-"));
process.on("exit", () => rmSync(work, { recursive: true, force: true }));
let fileNo = 0;

function runGo(src) {
	const dir = join(work, `go${fileNo++}`);
	mkdirSync(dir);
	const file = join(dir, "main.go");
	writeFileSync(file, src);
	try {
		const out = execFileSync("go", ["run", file], {
			encoding: "utf8",
			stdio: ["ignore", "pipe", "pipe"],
			env: { ...process.env, GOTOOLCHAIN: "local" },
			timeout: 60000,
		});
		return { ok: true, out };
	} catch (e) {
		return {
			ok: false,
			out: String(e.stdout ?? ""),
			err: String(e.stderr || e.message),
		};
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

const SINKS = "__gofrontFuzzSinks";
let sinkId = 0;

// Compiles `src` for `target` and runs it in this process, capturing stdout.
// kind: ok | compile | invalid-wasm | runtime
async function runGofront(src, target) {
	const dir = join(work, `gf${fileNo++}`);
	mkdirSync(dir);
	const goPath = join(dir, "main.go");
	writeFileSync(goPath, src);
	const id = sinkId++;
	let out = "";
	globalThis[SINKS] ??= new Map();
	globalThis[SINKS].set(id, (s) => {
		out += s;
	});
	try {
		const compiled = compileProgram(goPath, target);
		if (compiled.kind !== "ok")
			return {
				kind: compiled.kind === "ice" ? "compile" : compiled.kind,
				out: "",
				err: compiled.err,
			};
		const { res, wasm } = compiled;
		const prelude = [
			`const __sink = globalThis.${SINKS}.get(${id});`,
			"const process = { stdout: { write: (s) => __sink(String(s)) } };",
			'const console = { log: (...a) => __sink(a.map(String).join(" ") + "\\n") };',
			wasm
				? `const __wasmBytes = new Uint8Array(Buffer.from("${Buffer.from(wasm).toString("base64")}", "base64"));`
				: "",
		];
		const body = res.js
			.replace(/^import\s[^;]+;\n?/gm, "")
			.replaceAll("globalThis.__GOFRONT_WASM_BYTES", "__wasmBytes");
		const file = join(dir, "bundle.mjs");
		writeFileSync(file, `${prelude.join("\n")}\n${body}`);
		try {
			await import(pathToFileURL(file).href);
		} catch (e) {
			return { kind: "runtime", out, err: firstLine(String(e?.message ?? e)) };
		}
		return { kind: "ok", out };
	} finally {
		globalThis[SINKS].delete(id);
		rmSync(dir, { recursive: true, force: true });
	}
}

const MAX_SAFE = 2n ** 53n;
function tooBig(text) {
	if (MODE !== "order") return false;
	for (const m of text.matchAll(/-?\d+/g)) {
		const v = BigInt(m[0]);
		if (v >= MAX_SAFE || v <= -MAX_SAFE) return true;
	}
	return false;
}

// ── Checking cases against targets ───────────────────────────

// Runs all cases as one program. Returns { goError } when Go rejects it, else
// { bad } mapping case index -> [{ target, kind, want, got, err }].
async function check(cases, targets = TARGETS) {
	const src = renderProgram(cases);
	const go = runGo(src);
	if (!go.ok) return { goError: go.err, src };
	const want = splitCases(go.out);
	const bad = new Map();
	for (const target of targets) {
		const gf = await runGofront(src, target);
		const got = splitCases(gf.out);
		for (let n = 0; n < cases.length; n++) {
			const w = want.get(n);
			if (w === undefined || tooBig(w)) continue;
			const g = got.get(n);
			if (g === w) continue;
			const kind = g === undefined && gf.kind !== "ok" ? gf.kind : "ok";
			const entry = {
				target,
				kind,
				want: w,
				got: g ?? "",
				err: kind === "ok" ? "" : gf.err,
			};
			if (!bad.has(n)) bad.set(n, []);
			bad.get(n).push(entry);
			if (gf.kind !== "ok" && g === undefined) break; // later cases never ran
		}
	}
	return { bad, src };
}

// ── Reduction ────────────────────────────────────────────────

const signature = (e) => `${e.target}:${e.kind}`;

// Index of the first candidate that still fails with `sig`, or -1. Output
// mismatches are checked in one program; a compile error or crash stops the
// later cases, so those signatures are checked one candidate at a time.
async function firstFailing(cands, sig) {
	const target = sig.split(":")[0];
	const matches = (bad, k) => {
		const e = bad?.get(k)?.[0];
		return e !== undefined && signature(e) === sig;
	};
	if (sig.endsWith(":ok")) {
		const { bad } = await check(cands, [target]);
		for (let k = 0; k < cands.length; k++) if (matches(bad, k)) return k;
		return -1;
	}
	for (let k = 0; k < cands.length; k++) {
		const { bad } = await check([cands[k]], [target]);
		if (matches(bad, 0)) return k;
	}
	return -1;
}

// Closures the statements call, directly or through other closures, in
// declaration order.
function usedClosures(c) {
	const used = new Set();
	const visit = (text) => {
		for (const fn of calledFuncs(text, c.funcs)) {
			if (used.has(fn.name)) continue;
			used.add(fn.name);
			visit(fn.muts.join(";"));
		}
	};
	visit(c.stmts.join(";"));
	return c.funcs.filter((f) => used.has(f.name));
}

function candidates(c) {
	const out = [];
	for (let k = c.stmts.length - 1; k >= 0; k--)
		out.push({ ...c, stmts: c.stmts.filter((_, q) => q !== k) });
	for (let f = 0; f < c.funcs.length; f++)
		for (let k = c.funcs[f].muts.length - 1; k >= 0; k--)
			out.push({
				...c,
				funcs: c.funcs.map((fn, q) =>
					q === f ? { ...fn, muts: fn.muts.filter((_, z) => z !== k) } : fn,
				),
			});
	if (c.prints.length > 1)
		for (let k = c.prints.length - 1; k >= 0; k--)
			out.push({ ...c, prints: c.prints.filter((_, q) => q !== k) });
	return out;
}

async function reduce(c, sig) {
	let cur = c;
	for (;;) {
		const cands = candidates(cur);
		if (cands.length === 0) return cur;
		const k = await firstFailing(cands, sig);
		if (k < 0) return cur;
		cur = cands[k];
	}
}

// ── Self-test, replay and case replay ────────────────────────

function selfTest() {
	const fail = (msg) => {
		console.error(`self-test failed: ${msg}`);
		process.exit(1);
	};
	const r = rng(1 * 2654435761);
	let calls = 0;
	for (let n = 0; n < 2000; n++) {
		const c = genOrderCase(r, STMTS);
		for (const st of c.stmts) {
			if (calledFuncs(st, c.funcs).length > 0) calls++;
			if (stmtConflicts(st, c.funcs))
				fail(
					`case ${n}: statement calls a closure that changes a variable it names: ${st}`,
				);
		}
	}
	if (calls === 0) fail("no generated statement calls a closure");
	for (let n = 0; n < 2000; n++) {
		const c = genOrderCase(r, STMTS);
		c.funcs.forEach((fn, k) => {
			for (const callee of calledFuncs(fn.muts.join(";"), c.funcs.slice(k)))
				fail(`case ${n}: ${fn.name} calls ${callee.name}, declared later`);
		});
	}
	// f1 only calls ks, and ks changes a: a statement that names a and calls
	// f1 depends on an order the spec leaves open.
	const nested = [
		{ name: "ks", muts: ["a = n"] },
		{ name: "f1", muts: ["ps = &ss[(m[ks(1)])&1]"] },
	];
	if (!stmtConflicts("xs[(f1(-4))&1] = ((a / 3) * -1)", nested))
		fail("a call through f1 to ks is not seen as changing a");
	if (stmtConflicts("xs[(f1(-4))&1] = ((j / 3) * -1)", nested))
		fail("a statement that names nothing ks changes is rejected");
	const text = (seed) => {
		const q = rng(seed * 2654435761);
		return renderProgram(
			Array.from({ length: 5 }, () => genOrderCase(q, STMTS)),
		);
	};
	const first = text(7000);
	if (first !== text(7000)) fail("seed 7000 is not deterministic");
	if (first === text(7001)) fail("different seeds gave the same program");
	console.log(
		`self-test ok (2000 cases, ${calls} statements with calls, transitive conflicts ok)`,
	);
	process.exit(0);
}

async function replaySource(src, targets) {
	const go = runGo(src);
	console.log(
		`go    ${go.ok ? go.out.trimEnd() : `ERROR ${firstLine(go.err)}`}`,
	);
	for (const t of targets.split(",")) {
		const gf = await runGofront(src, t);
		const tag = gf.kind === "ok" ? "" : ` [${gf.kind}: ${gf.err}]`;
		const same =
			go.ok && gf.kind === "ok" && gf.out === go.out ? "  (same)" : "";
		console.log(`${t.padEnd(5)} ${gf.out.trimEnd()}${tag}${same}`);
	}
}

// Case n of the batch with this seed, regenerated from the seed alone.
function regenerateCase(seed, n) {
	const r = rng(seed * 2654435761);
	const gen = GENERATORS[MODE];
	let c;
	for (let k = 0; k <= n; k++) c = gen(r, STMTS);
	return c;
}

function reproduceCommand(seed, n) {
	return `node test/fuzz/difffuzz.js --mode ${MODE} --stmts ${STMTS}${ANON_EMBED ? " --anon-embed" : ""} --case ${seed}:${n}`;
}

if (SELF_TEST) selfTest();

if (REPLAY) {
	let src;
	try {
		src = readFileSync(REPLAY, "utf8");
	} catch (e) {
		console.error(`error: ${e.message}`);
		process.exit(1);
	}
	await replaySource(src, opt("targets", "js,both,wasm"));
	process.exit(0);
}

if (CASE) {
	const m = /^(\d+):(\d+)$/.exec(CASE);
	if (!m) {
		console.error("--case needs SEED:N");
		process.exit(2);
	}
	const src = renderProgram([regenerateCase(Number(m[1]), Number(m[2]))]);
	console.log(src);
	if (PRINT) process.exit(0);
	await replaySource(src, opt("targets", TARGETS.join(",")));
	process.exit(0);
}

if (PRINT) {
	const r = rng(SEED * 2654435761);
	const gen = GENERATORS[MODE];
	console.log(
		renderProgram(Array.from({ length: CASES }, () => gen(r, STMTS))),
	);
	process.exit(0);
}

// ── Main loop ────────────────────────────────────────────────

const seen = new Set();
let totalCases = 0;
let findings = 0;
let goRejects = 0;
mkdirSync(OUT, { recursive: true });
console.log(
	`difffuzz mode=${MODE} seed=${SEED} batches=${BATCHES} cases=${CASES} targets=${TARGETS.join(",")}`,
);

for (let b = 0; b < BATCHES; b++) {
	const seed = SEED + b;
	const r = rng(seed * 2654435761);
	const gen = GENERATORS[MODE];
	const cases = Array.from({ length: CASES }, () => gen(r, STMTS));
	const res = await check(cases);
	if (res.goError) {
		goRejects++;
		const f = join(OUT, `go-reject-${MODE}-${seed}.go`);
		writeFileSync(f, res.src);
		console.log(
			`batch ${b} (seed ${seed}): Go rejected program -> ${f}\n  ${firstLine(res.goError)}`,
		);
		continue;
	}
	totalCases += CASES;
	for (const [n, entries] of res.bad) {
		// Reduce once, against the first failing target, then see which
		// targets the reduced case still fails on.
		let c = cases[n];
		if (REDUCE) c = await reduce(c, signature(entries[0]));
		const usedFuncs = usedClosures(c);
		const key = `${c.stmts.join(";").replace(/-?\d+/g, "N")}|${usedFuncs.map((f) => f.muts.join(";")).join("|")}`;
		if (seen.has(key)) continue;
		seen.add(key);
		const fails = [];
		for (const t of TARGETS) {
			const e = (await check([c], [t])).bad?.get(0)?.[0];
			if (e) fails.push(e);
		}
		if (fails.length === 0) continue;
		findings++;
		const e = fails[0];
		const tlist = fails.map(
			(f) => `${f.target}${f.kind === "ok" ? "" : `(${f.kind})`}`,
		);
		const name = `${MODE}-${seed}-${n}-${fails.map((f) => f.target).join("+")}.go`;
		const header = [
			`// reproduce (unreduced): ${reproduceCommand(seed, n)}`,
			`// difffuzz finding: fails on ${tlist.join(", ")}${e.err ? ` err=${e.err}` : ""}`,
			`// want (go): ${e.want.split("\n").join(" | ")}`,
			...fails.map(
				(f) => `// got ${f.target.padEnd(5)}: ${f.got.split("\n").join(" | ")}`,
			),
		].join("\n");
		writeFileSync(join(OUT, name), `${header}\n${renderProgram([c])}`);
		const body = [
			...usedFuncs.map((f) => f.render(f.muts)),
			...c.stmts,
			`fmt.Println(${c.prints.join(", ")})`,
		];
		console.log(
			`\n✗ ${name}  [${tlist.join(", ")}]${e.err ? ` ${e.err}` : ""}`,
		);
		console.log(`  reproduce: ${reproduceCommand(seed, n)}`);
		console.log(`  want  ${e.want}`);
		for (const f of fails) console.log(`  ${f.target.padEnd(5)} ${f.got}`);
		console.log(`  ${body.join("\n  ")}`);
	}
	console.log(`batch ${b + 1}/${BATCHES} done (${findings} findings)`);
}

console.log(
	`\n${totalCases} cases, ${findings} distinct findings, ${goRejects} batches rejected by Go. Repros in ${OUT}`,
);
