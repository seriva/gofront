// Conformance audit against Go: checks that every `// ERROR "text"` marker of
// the reject corpus (test/unit/fixtures/conformance/reject) is part of a
// message Go's own type checker (go/types, through test/fuzz/gocheck) reports
// on that line. A marker Go does not say is text GoFront made up, which the
// corpus then enforces as if it were Go's.
//
//   node test/fuzz/conformance-go.js [--baseline FILE] [--write-baseline]
//   node test/fuzz/conformance-go.js --show CASE
//     prints Go's messages next to the markers of one case
//
// Manual, like `npm run fuzz:check`: it needs the Go toolchain, which
// `npm test` does not.
//
// Known misses live in the baseline file, one `<case>:<line>` per line
// followed by `# <tag>`: the root cause that explains it (`D1`-`D4` name the
// roots of the diagnostic-text plan), or `excluded: <why>` for a diagnostic
// with no Go counterpart. The run fails on a miss the baseline does not list
// and on a listed one that no longer occurs, so a fix removes its line and a
// regression shows up as a new one. --write-baseline rewrites the file from
// the current run: a line that stays keeps its tag and a new line gets the
// tag of its template (TAG_RULES).

import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const GOCHECK = join(HERE, "gocheck");
const REJECT = join(HERE, "..", "unit", "fixtures", "conformance", "reject");
const DEFAULT_BASELINE = join(HERE, "conformance-go-baseline.txt");

export const GOFRONT_ONLY = "excluded: gofront-only";
export const DOCUMENTED_RESTRICTION = "excluded: documented-restriction";
const UNTRIAGED = "untriaged";

// ── Markers ──────────────────────────────────────────────────

// The `// ERROR "..."` markers of a source: [{ line, text }] (1-based lines).
export function extractMarkers(source) {
	const out = [];
	const lines = source.split("\n");
	for (let i = 0; i < lines.length; i++) {
		const m = /\/\/ ERROR "((?:[^"\\]|\\.)*)"/.exec(lines[i]);
		if (m) out.push({ line: i + 1, text: JSON.parse(`"${m[1]}"`) });
	}
	return out;
}

// The markers no Go message on their line contains. `errors` is Go's list for
// the program (`{ file, line, msg }`); only `main.go` carries markers.
export function findMisses(markers, errors) {
	const misses = [];
	for (const marker of markers) {
		const said = errors
			.filter((e) => e.file === "main.go" && e.line === marker.line)
			.map((e) => e.msg);
		if (!said.some((msg) => msg.includes(marker.text)))
			misses.push({ ...marker, said });
	}
	return misses;
}

// ── Baseline ─────────────────────────────────────────────────

// Map of `<case>:<line>` to its tag.
export function parseBaseline(text) {
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

const BASELINE_HEADER = [
	"# Reject markers that are not part of Go's message on their line.",
	"# Written by `npm run conformance:go -- --write-baseline`: a new line gets",
	"# the tag of its template (TAG_RULES), and a tag edited here is kept.",
	"# See test/fuzz/conformance-go.js for the format.",
	"",
].join("\n");

// `entries` is a Map of `<case>:<line>` to the tag it has now (or ""), and
// `previous` the tags of the old baseline.
export function formatBaseline(entries, previous = new Map()) {
	const lines = [...entries.keys()]
		.sort(compareEntries)
		.map((e) => `${e} # ${previous.get(e) || entries.get(e) || UNTRIAGED}`);
	return `${BASELINE_HEADER}${lines.join("\n")}\n`;
}

function compareEntries(a, b) {
	const [ca, la] = splitEntry(a);
	const [cb, lb] = splitEntry(b);
	return ca < cb ? -1 : ca > cb ? 1 : la - lb;
}

function splitEntry(entry) {
	const at = entry.lastIndexOf(":");
	return [entry.slice(0, at), Number(entry.slice(at + 1))];
}

// What a run says against the baseline. `found` holds the `<case>:<line>` of
// every miss.
export function compareBaseline(found, baseline) {
	const problems = [];
	for (const entry of baseline.keys())
		if (!found.has(entry))
			problems.push(`baseline entry no longer occurs, remove it: ${entry}`);
	for (const entry of found)
		if (!baseline.has(entry))
			problems.push(`new miss, not in the baseline: ${entry}`);
	return problems;
}

// The tag --write-baseline gives a miss that had none: the root cause whose
// rule covers it. `D1`-`D4` name the roots of the diagnostic-text plan; a word
// names a root no plan schedules yet. A rule sees `{ name, marker, said,
// goAccepted, gofrontOnly }`; the first match wins. A rule tags a whole
// template, so a miss that outlives the fix of its root needs a look of its own.
const said = (m) => m.said.join("\n");
const TAG_RULES = [
	[(m) => m.gofrontOnly, GOFRONT_ONLY],
	[
		(m) => m.goAccepted && m.name.startsWith("identity_"),
		DOCUMENTED_RESTRICTION,
	],
	[(m) => m.goAccepted, "excluded: verdict"],
	[
		(m) => /^(too many|not enough) return values/.test(m.marker.text),
		"excluded: secondary-lines",
	],
	[
		(m) =>
			/^(cannot assign to|cannot take address of) /.test(m.marker.text) &&
			/^undefined: /.test(said(m)),
		GOFRONT_ONLY,
	],
	[
		(m) =>
			/^cannot (assign to|take address of) /.test(m.marker.text) &&
			/\((type\) is not an expression|built-in\) must be called)|use of package/.test(
				said(m),
			),
		"type-as-value-text",
	],
	[(m) => /^Cannot assign\b/.test(m.marker.text), "D3"],
	[(m) => /^Invalid operation\b/.test(m.marker.text), "D4"],
	[(m) => /\bstruct\{\.\.\.\}|\binterface\{\.\.\.\}/.test(m.marker.text), "D2"],
	[(m) => /\bduplicate (key|case)\b/.test(m.marker.text), "D2"],
	[(m) => /\bexpression\b/.test(m.marker.text), "D1"],
	[(m) => /^cannot convert\b/.test(m.marker.text), "D1"],
	[
		(m) =>
			/^cannot range over /.test(m.marker.text) && /constant/.test(said(m)),
		"D1",
	],
	[(m) => /^operator \S+ not defined/.test(m.marker.text), "D4"],
	[
		(m) =>
			/shifted operand|shift count|^invalid shift count|^overflows /.test(
				`${m.marker.text} ${said(m)}`,
			),
		"shift-text",
	],
	[
		(m) =>
			/\bof interface type any\b|\bof \w+ type \w+\)/.test(said(m)) ||
			/^any_/.test(m.name),
		"any-operand-kind",
	],
	[
		(m) => /^(Undefined: |Unknown type )'/.test(m.marker.text),
		"undefined-text",
	],
	[(m) => /label/.test(m.marker.text), "label-text"],
	[
		(m) => /^cannot use generic function /.test(m.marker.text),
		"generic-value-text",
	],
	[(m) => /^cannot range over func/.test(m.marker.text), "range-text"],
	[(m) => /declared and not used$/.test(m.marker.text), "unused-binding-text"],
];

export function defaultTag(miss) {
	for (const [rule, tag] of TAG_RULES)
		if (typeof rule === "function" ? rule(miss) : rule.test(miss)) return tag;
	return UNTRIAGED;
}

// ── Corpus ───────────────────────────────────────────────────

// A directory case: `main.go` plus one `.go` file per package directory,
// keyed by the import path `"./<dir>"`. `gofrontOnly` is set for a case Go
// cannot check: a `.d.ts` interop file, or a package of several files.
function readDirCase(path) {
	const files = readdirSync(path);
	const src = readFileSync(join(path, "main.go"), "utf8");
	const pkgs = {};
	let gofrontOnly = files.some((f) => f.endsWith(".d.ts"));
	for (const f of files) {
		const sub = join(path, f);
		if (!statSync(sub).isDirectory()) continue;
		const goFiles = readdirSync(sub).filter((n) => n.endsWith(".go"));
		if (goFiles.length !== 1) gofrontOnly = true;
		else pkgs[`./${f}`] = readFileSync(join(sub, goFiles[0]), "utf8");
	}
	return { src, pkgs, gofrontOnly };
}

// Every reject case: `{ name, src, pkgs, gofrontOnly, markers }`.
export function loadCases(dir = REJECT) {
	return readdirSync(dir)
		.filter((f) => f.endsWith(".go") || statSync(join(dir, f)).isDirectory())
		.sort()
		.map((f) => {
			const isDir = !f.endsWith(".go");
			const found = isDir
				? readDirCase(join(dir, f))
				: {
						src: readFileSync(join(dir, f), "utf8"),
						pkgs: {},
						gofrontOnly: false,
					};
			return {
				name: isDir ? f : f.slice(0, -3),
				...found,
				markers: extractMarkers(found.src),
			};
		});
}

// ── Go ───────────────────────────────────────────────────────

// Go's verdict on every case, by name: `{ ok, errors }`. One process checks
// the whole list.
function runGo(cases) {
	const input = JSON.stringify(
		cases.map((c) => ({ id: c.name, src: c.src, pkgs: c.pkgs, all: true })),
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

// The misses of every case: Map of `<case>:<line>` to `{ tag, miss }`.
export function auditCases(cases, verdicts) {
	const found = new Map();
	for (const c of cases) {
		const verdict = c.gofrontOnly ? null : verdicts.get(c.name);
		const errors = verdict?.errors ?? [];
		for (const marker of findMisses(c.markers, errors)) {
			const miss = {
				name: c.name,
				marker,
				said: marker.said,
				goAccepted: verdict?.ok === true,
				gofrontOnly: c.gofrontOnly || verdict?.errors?.some((e) => e.syntax),
			};
			found.set(`${c.name}:${marker.line}`, { tag: defaultTag(miss), miss });
		}
	}
	return found;
}

// ── Main ─────────────────────────────────────────────────────

function opt(args, name, def) {
	const i = args.indexOf(`--${name}`);
	return i >= 0 ? args[i + 1] : def;
}

function show(cases, verdicts, name) {
	const c = cases.find((x) => x.name === name);
	if (!c) {
		console.error(`no case ${name}`);
		process.exit(2);
	}
	const verdict = verdicts.get(name) ?? {};
	if (c.gofrontOnly) console.log("go     not checked (gofront-only case)");
	for (const e of verdict.errors ?? [])
		console.log(`go     ${e.file}:${e.line}:${e.col}: ${e.msg}`);
	if (verdict.ok) console.log("go     accepted");
	for (const m of c.markers) console.log(`marker ${m.line}: ${m.text}`);
}

function main(args) {
	const baselineFile = resolve(opt(args, "baseline", DEFAULT_BASELINE));
	const cases = loadCases();
	const toCheck = cases.filter((c) => !c.gofrontOnly);
	const verdicts = runGo(toCheck);
	const showName = opt(args, "show", null);
	if (showName) return show(cases, verdicts, showName);
	const found = auditCases(cases, verdicts);
	const baseline = readBaseline(baselineFile);
	const markers = cases.reduce((n, c) => n + c.markers.length, 0);
	if (args.includes("--write-baseline")) {
		const tags = new Map([...found].map(([k, v]) => [k, v.tag]));
		writeFileSync(baselineFile, formatBaseline(tags, baseline));
		console.log(`wrote ${found.size} entries to ${baselineFile}`);
		return;
	}
	const problems = compareBaseline(new Set(found.keys()), baseline);
	for (const p of problems.slice(0, 40)) {
		console.error(`\n✗ ${p}`);
		const entry = found.get(p.slice(p.lastIndexOf(": ") + 2));
		if (entry)
			console.error(
				`  marker  ${entry.miss.marker.text}\n  go      ${entry.miss.said.join(" | ") || "(no error on this line)"}`,
			);
	}
	if (problems.length > 40)
		console.error(`\n… and ${problems.length - 40} more`);
	console.log(
		`${cases.length} cases, ${markers} markers, ${found.size} not part of Go's message, ${problems.length} not matching the baseline`,
	);
	if (problems.length) process.exit(1);
}

if (
	process.argv[1] &&
	import.meta.url === pathToFileURL(process.argv[1]).href
) {
	try {
		main(process.argv.slice(2));
	} catch (e) {
		console.error(`error: ${e.message}`);
		process.exit(2);
	}
}
