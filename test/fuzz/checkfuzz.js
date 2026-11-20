// Checker differential fuzzer: type-checks every case of a grid of small Go
// programs (check-grid.js) with Go's own type checker (go/types, through
// test/fuzz/gocheck) and with GoFront, and reports each case on which the two
// disagree.
//
//   node test/fuzz/checkfuzz.js [--section a,b] [--sample N --seed S]
//     [--baseline FILE] [--messages] [--write-baseline]
//   node test/fuzz/checkfuzz.js --show KEY
//     prints the program of one case and what Go and GoFront say about it
//   node test/fuzz/checkfuzz.js --self-test
//     checks the grid and the baseline without Go (run by the unit tests)
//
// A disagreement has one of these classes:
//   go-reject/gf-accept  Go reports the program, GoFront compiles it
//   go-accept/gf-reject  Go accepts the program, GoFront reports it
//   ice                  GoFront crashes (on `js`, or on `wasm` after `js`
//                        accepted)
//   invalid-wasm         GoFront emits a module that does not validate
//   wasm-reject          Go and `js` accept the program, `wasm` reports it
//   message              both report it, but GoFront's message does not
//                        contain Go's (only with --messages, never a failure)
//
// Known disagreements live in the baseline file, one `<key>:<class>` per line
// followed by `# <tag>`: the root cause that explains it, or `excluded: <why>`
// for a difference that is by design. The run fails on a disagreement the
// baseline does not list and on a listed one that no longer occurs, so a fix
// removes its lines and a regression shows up as a new one.
// --write-baseline rewrites the file from the current run: a line that stays
// keeps its tag and a new line gets the tag of its template (TAG_RULES).

import { spawnSync } from "node:child_process";
import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { evictParseCache } from "../../src/compiler.js";
import { Lexer } from "../../src/lexer/lexer.js";
import { Parser } from "../../src/parser/index.js";
import { gridCases, SECTION_NAMES, sampleCases } from "./check-grid.js";
import { compileProgram } from "./gofront-run.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const GOCHECK = join(HERE, "gocheck");
const DEFAULT_BASELINE = join(HERE, "check-baseline.txt");

// ── CLI ──────────────────────────────────────────────────────

const args = process.argv.slice(2);
function opt(name, def) {
	const i = args.indexOf(`--${name}`);
	return i >= 0 ? args[i + 1] : def;
}
const SECTIONS = opt("section", SECTION_NAMES.join(",")).split(",");
const SAMPLE = Number(opt("sample", 0));
const SEED = Number(opt("seed", 1));
const BASELINE = resolve(opt("baseline", DEFAULT_BASELINE));
const SHOW = opt("show", null);
const MESSAGES = args.includes("--messages");
const WRITE_BASELINE = args.includes("--write-baseline");
const SELF_TEST = args.includes("--self-test");

// Cases GoFront's parser does not read. Go's parser reads them all, so the
// run reports them like any other disagreement; listing them here keeps a
// case the grid renders wrongly from hiding among them.
const UNPARSED = [
	/^conv:(value:func,|func:)/, // `(func())(x)`, `(func(T))(x)`
	/^conv:ptr:(slice|array|map|func|struct),/, // `(*[]int)(x)`
	/^conv:(array|slice|map):func,/, // `([]func())(x)`, `(map[string]func())(x)`
	/^recv:decl:(ptr-ptr-struct|slice-literal|struct-literal)$/, // `func (r **P)`
	/^names:call:(predeclared-type|shadow-type-\w+|shadow-any)$/, // `int()`
];
const unparsed = (key) => UNPARSED.some((re) => re.test(key));

// ── Baseline ─────────────────────────────────────────────────

const UNTRIAGED = "untriaged";

// Map of `<key>:<class>` to its tag.
function parseBaseline(text) {
	const entries = new Map();
	for (const raw of text.split("\n")) {
		const line = raw.trim();
		if (!line || line.startsWith("#")) continue;
		const at = line.indexOf(" # ");
		const entry = at < 0 ? line : line.slice(0, at).trim();
		entries.set(entry, at < 0 ? "" : line.slice(at + 3).trim());
	}
	return entries;
}

function readBaseline(file) {
	try {
		return parseBaseline(readFileSync(file, "utf8"));
	} catch (e) {
		if (e.code === "ENOENT") return new Map();
		throw e;
	}
}

const caseKey = (entry) => entry.slice(0, entry.lastIndexOf(":"));

// What a run says against the baseline. `found` holds the `<key>:<class>` of
// every disagreement and `ran` the key of every case that ran, so a sampled
// run only judges the baseline lines of the cases it sampled.
function compareBaseline(found, ran, baseline) {
	const problems = [];
	for (const entry of found)
		if (!baseline.has(entry))
			problems.push(`new disagreement, not in the baseline: ${entry}`);
	for (const entry of baseline.keys())
		if (ran.has(caseKey(entry)) && !found.has(entry))
			problems.push(`baseline entry no longer occurs, remove it: ${entry}`);
	return problems;
}

const BASELINE_HEADER = [
	"# Known disagreements between GoFront's type checker and go/types.",
	"# Written by `node test/fuzz/checkfuzz.js --write-baseline`: a new line gets",
	"# the tag of its template (TAG_RULES), and a tag edited here is kept.",
	"# See test/fuzz/checkfuzz.js for the format.",
	"",
].join("\n");

// The tag --write-baseline gives an entry that had none: the root cause
// whose rule covers the entry's template. `O<n>`, `R<n>` and `W<n>` name the
// roots of the checker-operand-rules, checker-go-rules and wasm-struct-types
// plans; a word names a root no plan schedules yet. The first matching rule
// wins. A rule tags a whole template, so an entry that outlives the fix of
// its root needs a look of its own.
const TPARAM_KIND = /[:,]T(any|comparable|num)[,:]/;
const TAG_RULES = [
	[
		/^names:addr:.*:wasm-reject$/,
		"excluded: wasm takes no address of a scalar variable or field",
	],
	[/^conv:ptr:.*:wasm-reject$/, "excluded: wasm converts no struct pointers"],
	[(e) => unparsed(caseKey(e)), "parser-conversion-type"],
	[/^range:\w+:T\w+:/, "R18"],
	[/^range:\w+:1<<63:/, "O4"],
	[/^builtins:arity:/, "R20"],
	[/^builtins:\w+:T\w+:/, "R12"],
	[/^comparable:constraint:/, "R13"],
	[/^comparable:mapkey:/, "map-key-comparability"],
	[/^binary:==:(struct,P|P,struct):invalid-wasm$/, "W1"],
	[/[:,](1\+0i|1i|1e40|1e400)[,:]/, "O4"],
	[/^builtins:(complex|real|imag):/, "builtin-complex-operands"],
	[/^(binary:==|switch:tag):.*:invalid-wasm$/, "wasm-iface-equality"],
	[/^incdec:.*:invalid-wasm$/, "O8"],
	[/^names:\w+:shadow-/, "R8"],
	[/^names:(assign|addr|incdec):/, "R5"],
	[/^names:/, "type-as-value"],
	[(e) => TPARAM_KIND.test(e) && /^(assign|conv):/.test(e), "type-param-value"],
	[(e) => TPARAM_KIND.test(e) && /^switch:/.test(e), "O7"],
	[(e) => TPARAM_KIND.test(e), "R9"],
	[/^binary:==:/, "O2"],
	[/^(binary:<<|opassign:<<=|shift):/, "O3"],
	[/^(binary|unary|opassign|incdec):/, "O1"],
	[/^(assign|conv):/, "O5"],
	[/^recv:/, "O6"],
	[/^switch:/, "O7"],
];

function defaultTag(entry) {
	for (const [rule, tag] of TAG_RULES)
		if (typeof rule === "function" ? rule(entry) : rule.test(entry)) return tag;
	return UNTRIAGED;
}

function writeBaseline(file, found, previous) {
	const lines = [...found]
		.sort()
		.map((entry) => `${entry} # ${previous.get(entry) || defaultTag(entry)}`);
	writeFileSync(file, `${BASELINE_HEADER}${lines.join("\n")}\n`);
}

// ── Go and GoFront ───────────────────────────────────────────

// Go's verdict on every case, by key. One process checks the whole list.
function runGo(cases) {
	const input = JSON.stringify(
		cases.map((c) => ({ id: c.key, src: c.src, pkgs: c.pkgs })),
	);
	const r = spawnSync("go", ["run", "."], {
		cwd: GOCHECK,
		input,
		encoding: "utf8",
		maxBuffer: 1 << 30,
		env: { ...process.env, GOTOOLCHAIN: "local" },
	});
	if (r.error?.code === "ENOENT")
		throw new Error("the Go toolchain (`go`) is not on PATH");
	if (r.status !== 0)
		throw new Error(`gocheck failed: ${r.stderr || r.error?.message}`);
	return new Map(JSON.parse(r.stdout).map((res) => [res.id, res]));
}

const work = mkdtempSync(join(tmpdir(), "gofront-checkfuzz-"));
process.on("exit", () => rmSync(work, { recursive: true, force: true }));
let dirNo = 0;

// GoFront's verdict on one case for `target` (see compileProgram).
function runGofront(c, target) {
	const dir = join(work, `c${dirNo++}`);
	mkdirSync(dir);
	const goPath = join(dir, "main.go");
	writeFileSync(goPath, c.src);
	const written = [goPath];
	for (const [path, src] of Object.entries(c.pkgs ?? {})) {
		mkdirSync(join(dir, path), { recursive: true });
		written.push(join(dir, path, "pkg.go"));
		writeFileSync(written.at(-1), src);
	}
	try {
		return compileProgram(goPath, target);
	} finally {
		for (const f of written) evictParseCache(f);
		rmSync(dir, { recursive: true, force: true });
	}
}

// GoFront's message for the error on `line`, else its first message, without
// the "Type error in main.go at line 6:6: " lead-in.
function gofrontMessage(compiled, line) {
	const errors = compiled.errors ?? [];
	const at = errors.find((e) => e.line === line) ?? errors[0];
	const text = String(at?.message ?? compiled.err ?? "").split("\n")[0];
	return text.replace(/^.*? at line \d+(:\d+)?: /, "");
}

// The class of the disagreement on case `c`, or null when Go and GoFront
// agree. `detail` says what each side reported.
function classify(c, go) {
	const js = runGofront(c, "js");
	const detail = { go: go.ok ? "accepted" : go.msg, gofront: js.err ?? "" };
	if (js.kind === "ice" || js.kind === "invalid-wasm")
		return { cls: js.kind, detail };
	if (!go.ok) return classifyRejected(go, js, detail);
	if (js.kind !== "ok")
		return {
			cls: "go-accept/gf-reject",
			detail: { ...detail, gofront: gofrontMessage(js, 0) },
		};
	return classifyOnWasm(c, detail);
}

// Go reports the program: GoFront must report it too, with Go's message.
function classifyRejected(go, js, detail) {
	if (js.kind === "ok")
		return {
			cls: "go-reject/gf-accept",
			detail: { ...detail, gofront: "accepted" },
		};
	const got = gofrontMessage(js, go.line);
	if (got.includes(go.msg)) return null;
	return { cls: "message", detail: { ...detail, gofront: got } };
}

// Go and `js` accept the program: `wasm` must compile it to a valid module.
function classifyOnWasm(c, detail) {
	const wasm = runGofront(c, "wasm");
	if (wasm.kind === "ok") return null;
	const said = wasm.kind === "compile" ? gofrontMessage(wasm, 0) : wasm.err;
	return {
		cls: wasm.kind === "compile" ? "wasm-reject" : wasm.kind,
		detail: { ...detail, gofront: `wasm: ${said}` },
	};
}

// ── Self-test ────────────────────────────────────────────────

// The repros the grid was built from: each must stay a case of the grid.
const LEDGER_KEYS = [
	"binary:<:bool,true",
	"binary:<:ptr,ptr",
	"binary:<:P,P",
	"binary:&&:1,1",
	"binary:&&:int,int",
	"binary:&&:nil,true",
	"unary:^:float64",
	"unary:^:1.5",
	"unary:-:bool",
	"unary:!:int",
	"binary:-:str,str",
	"binary:<:complex128,1i",
	"binary:==:I,1",
	"binary:==:I,P",
	"binary:==:error,str",
	"binary:==:slice,1",
	"binary:<<:1.5,1",
	"binary:<<:str,1",
	"shift:nonconst:float64,1",
	"shift:nonconst:complex128,1",
	"opassign:<<=:float64,1.5",
	"binary:+:float64,1+0i",
	"assign:value:int,1+0i",
	"binary:==:int,1+0i",
	"binary:==:float32,1e40",
	"assign:value:float32,1e40",
	"conv:value:float32,1e40",
	"assign:value:float64,1e400",
	"assign:value:complex64,1e40",
	"assign:ptr:any,int",
	"assign:array:any,int",
	"assign:ptr:MI,int",
	"assign:slice:any,int",
	"conv:ptr:any,E",
	"conv:slice:MI,int",
	"recv:decl:empty-iface",
	"recv:decl:ptr-iface",
	"recv:decl:ptr-type",
	"recv:decl:int",
	"recv:decl:alias-unnamed",
	"switch:tag:Tany,nil",
	"switch:tag:Tcomparable,nil",
	"switch:empty:PS",
	"switch:tagless:any",
	"switch:tagless:E",
	"names:assign:std-func",
	"names:assign:std-type",
	"names:addr:std-type",
	"names:assign:dot-func",
	"names:type:local-type",
	"names:call:shadow-builtin-func",
	"range:key:Tfloat",
	"range:key:Tmixed",
	"range:none:Tfuncnoiter",
	"range:key:Titer1",
	"range:none:1<<63",
	"range:kv:int",
	"range:assign:funcnoiter",
	"comparable:constraint:PS",
	"comparable:constraint:Tany",
	"comparable:mapkey:SAS",
	"builtins:len:Tany",
	"builtins:arity:clear-0",
	"builtins:complex:int",
];

const CLASSES = new Set([
	"go-reject/gf-accept",
	"go-accept/gf-reject",
	"ice",
	"invalid-wasm",
	"wasm-reject",
]);

function parses(src) {
	try {
		new Parser(new Lexer(src, "main.go").tokenize(), "main.go", src).parse();
		return true;
	} catch {
		return false;
	}
}

function fail(msg) {
	console.error(`self-test failed: ${msg}`);
	process.exit(1);
}

// Every case has a well-formed, unique key and parses with GoFront's parser
// (but for UNPARSED), and the grid still holds the ledger repros. Returns
// the keys.
function checkGrid(cases) {
	const keys = new Set();
	for (const c of cases) {
		if (!/^[a-z]+:[^:\s#]+:[^:\s#]+$/.test(c.key))
			fail(`malformed key ${c.key}`);
		if (keys.has(c.key)) fail(`duplicate key ${c.key}`);
		keys.add(c.key);
		if (parses(c.src) !== unparsed(c.key)) continue;
		fail(
			unparsed(c.key)
				? `${c.key} parses now: narrow UNPARSED`
				: `${c.key} does not parse:\n${c.src}`,
		);
	}
	for (const re of UNPARSED)
		if (![...keys].some((key) => re.test(key)))
			fail(`UNPARSED pattern ${re} matches no case`);
	for (const key of LEDGER_KEYS)
		if (!keys.has(key)) fail(`the grid lost the repro ${key}`);
	return keys;
}

function checkSampling(cases) {
	const pick = (seed) =>
		sampleCases(cases, 200, seed)
			.map((c) => c.key)
			.join("\n");
	const first = pick(1);
	if (first !== pick(1)) fail("seed 1 does not pick the same cases twice");
	if (first === pick(2)) fail("different seeds picked the same cases");
	if (sampleCases(cases, 200, 1).length !== 200) fail("sample size is off");
}

function checkBaselineJudgement() {
	const baseline = parseBaseline("a:t:x:ice # O1\nb:t:y:ice # O2\n");
	const ran = new Set(["a:t:x", "b:t:y", "c:t:z"]);
	const stale = compareBaseline(new Set(["a:t:x:ice"]), ran, baseline);
	if (stale.length !== 1 || !stale[0].includes("b:t:y:ice"))
		fail("a baseline entry that no longer occurs is not reported");
	const fresh = compareBaseline(
		new Set(["a:t:x:ice", "b:t:y:ice", "c:t:z:ice"]),
		ran,
		baseline,
	);
	if (fresh.length !== 1 || !fresh[0].includes("c:t:z:ice"))
		fail("a disagreement missing from the baseline is not reported");
	if (compareBaseline(new Set(["a:t:x:ice"]), new Set(["a:t:x"]), baseline)[0])
		fail("a sampled run judged a baseline entry of a case it did not run");
}

// Every entry of the committed baseline names a case, a class and a tag.
function checkCommittedBaseline(keys) {
	const committed = readBaseline(DEFAULT_BASELINE);
	for (const [entry, tag] of committed) {
		if (!keys.has(caseKey(entry)))
			fail(`the baseline names ${entry}, which is not a case of the grid`);
		if (!CLASSES.has(entry.slice(entry.lastIndexOf(":") + 1)))
			fail(`the baseline entry ${entry} has no known class`);
		if (!tag) fail(`the baseline entry ${entry} has no tag`);
	}
	return committed.size;
}

function selfTest() {
	const cases = gridCases();
	const keys = checkGrid(cases);
	checkSampling(cases);
	checkBaselineJudgement();
	const entries = checkCommittedBaseline(keys);
	console.log(
		`self-test ok (${cases.length} cases, ${entries} baseline entries)`,
	);
}

// ── Main ─────────────────────────────────────────────────────

function show(key) {
	const c = gridCases().find((x) => x.key === key);
	if (!c) {
		console.error(`no case ${key}`);
		process.exit(2);
	}
	console.log(c.src);
	for (const [path, src] of Object.entries(c.pkgs ?? {}))
		console.log(`// ${path}/pkg.go\n${src}`);
	const go = runGo([c]).get(key);
	console.log(
		`go     ${go.ok ? "accepted" : `${go.line}:${go.col}: ${go.msg}`}`,
	);
	for (const target of ["js", "wasm"]) {
		const r = runGofront(c, target);
		const said =
			r.kind === "ok"
				? "accepted"
				: `[${r.kind}] ${(r.errors ?? []).map((e) => e.message).join(" | ") || r.err}`;
		console.log(`${target.padEnd(6)} ${said}`);
	}
}

// The cases of the run and Go's verdict on each.
function loadCases() {
	let cases = gridCases(SECTIONS);
	if (SAMPLE > 0) cases = sampleCases(cases, SAMPLE, SEED);
	console.log(
		`checkfuzz sections=${SECTIONS.join(",")} cases=${cases.length}${SAMPLE > 0 ? ` (sample of ${SAMPLE}, seed ${SEED})` : ""}`,
	);
	const verdicts = runGo(cases);
	const syntax = cases.filter((c) => verdicts.get(c.key)?.syntax);
	for (const c of syntax.slice(0, 10))
		console.error(
			`Go cannot parse ${c.key}: ${verdicts.get(c.key).msg}\n${c.src}`,
		);
	if (syntax.length)
		throw new Error(`${syntax.length} cases are not Go: fix the grid`);
	return { cases, verdicts };
}

// Runs GoFront on every case. `found` maps `<key>:<class>` to what each side
// said, `messages` lists the message-only differences and `counts` tallies
// both by section and class.
function findDisagreements(cases, verdicts) {
	const found = new Map();
	const messages = [];
	const counts = new Map();
	let done = 0;
	for (const c of cases) {
		const res = classify(c, verdicts.get(c.key));
		if (++done % 2000 === 0)
			process.stderr.write(`  ${done}/${cases.length}\n`);
		if (!res) continue;
		if (res.cls === "message") messages.push([c.key, res.detail]);
		else found.set(`${c.key}:${res.cls}`, res.detail);
		const section = c.key.slice(0, c.key.indexOf(":"));
		const tally = `${section.padEnd(9)} ${res.cls}`;
		counts.set(tally, (counts.get(tally) ?? 0) + 1);
	}
	return { found, messages, counts };
}

function printSummary({ messages, counts }) {
	console.log("\ndisagreements by section and class:");
	for (const [tally, n] of [...counts].sort())
		if (MESSAGES || !tally.endsWith(" message"))
			console.log(`  ${tally.padEnd(30)} ${n}`);
	if (!MESSAGES) return;
	for (const [key, d] of messages)
		console.log(
			`\nmessage ${key}\n  go       ${d.go}\n  gofront  ${d.gofront}`,
		);
}

// Rewrites the baseline from this run. A partial run keeps the entries of
// the cases it did not run.
function updateBaseline(found, ran, baseline) {
	const kept = new Set(found.keys());
	for (const entry of baseline.keys())
		if (!ran.has(caseKey(entry))) kept.add(entry);
	writeBaseline(BASELINE, kept, baseline);
	console.log(`\nwrote ${kept.size} entries to ${BASELINE}`);
}

// Prints what does not match the baseline and returns how many entries.
function reportProblems(found, ran, baseline) {
	const problems = compareBaseline(new Set(found.keys()), ran, baseline);
	for (const p of problems.slice(0, 40)) {
		console.error(`\n✗ ${p}`);
		const d = found.get(p.slice(p.indexOf(": ") + 2));
		if (d) console.error(`  go       ${d.go}\n  gofront  ${d.gofront}`);
	}
	if (problems.length > 40)
		console.error(`\n… and ${problems.length - 40} more`);
	return problems.length;
}

function run() {
	const { cases, verdicts } = loadCases();
	const result = findDisagreements(cases, verdicts);
	printSummary(result);
	const ran = new Set(cases.map((c) => c.key));
	const baseline = readBaseline(BASELINE);
	if (WRITE_BASELINE) return updateBaseline(result.found, ran, baseline);
	const problems = reportProblems(result.found, ran, baseline);
	console.log(
		`\n${cases.length} cases, ${result.found.size} disagreements, ${problems} not matching the baseline`,
	);
	if (problems) process.exit(1);
}

try {
	if (SELF_TEST) selfTest();
	else if (SHOW) show(SHOW);
	else run();
} catch (e) {
	console.error(`error: ${e.message}`);
	process.exit(2);
}
