// Bundle size budgets
//
// Builds a fixed set of small programs and every example app under example/
// with `gofront build --release` and fails when an `app.js` is larger than its
// ceiling in bundle-size.baseline.json.  The ceilings record what each import
// costs today, so growth shows up in `npm test`.
//
//   node test/perf/bundle-size.js              check every fixture against its ceiling
//   node test/perf/bundle-size.js --update     rewrite the ceilings (measured size x 1.05)
//   node test/perf/bundle-size.js --self-test  prove a ceiling 1 byte too low fails

import { spawnSync } from "node:child_process";
import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { listExamples } from "../../scripts/build-examples.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const BASELINE = join(ROOT, "test/perf/bundle-size.baseline.json");
const HEADROOM = 1.05;

const mainPkg = (imports, body, extra = "") =>
	`package main\n\n${imports ? `import (\n${imports}\n)\n\n` : ""}${extra}func main() {\n${body}\n}\n`;

// name -> { path inside the fixture: source }. `main.go` is the entry package.
export const FIXTURES = {
	println: {
		"main.go": mainPkg("", `\tprintln("hello")`),
	},
	"fmt-println": {
		"main.go": mainPkg(`\t"fmt"`, `\tfmt.Println("hello")`),
	},
	"fmt-sprintf": {
		"main.go": mainPkg(
			`\t"fmt"`,
			`\ts := fmt.Sprintf("%d-%s", 42, "x")\n\tprintln(s)`,
		),
	},
	strconv: {
		"main.go": mainPkg(
			`\t"strconv"`,
			`\tprintln(strconv.Itoa(42), strconv.FormatFloat(1.5, 'f', 2, 64))`,
		),
	},
	strings: {
		"main.go": mainPkg(
			`\t"strings"`,
			`\tprintln(strings.ToUpper("abc"), len(strings.Split("a,b,c", ",")))`,
		),
	},
	"json-unmarshal": {
		"main.go": mainPkg(
			`\t"encoding/json"`,
			`\tvar c Config\n\tif err := json.Unmarshal([]byte(\`{"name":"a","size":3}\`), &c); err != nil {\n\t\tpanic(err)\n\t}\n\tprintln(c.Name, c.Size)`,
			`type Config struct {\n\tName string \`json:"name"\`\n\tSize int    \`json:"size"\`\n}\n\n`,
		),
	},
	"json-unmarshal-any": {
		"main.go": mainPkg(
			`\t"encoding/json"`,
			`\tvar c Config\n\tif err := json.Unmarshal([]byte(\`{"name":"a","extra":[1,2]}\`), &c); err != nil {\n\t\tpanic(err)\n\t}\n\tprintln(c.Name)`,
			`type Config struct {\n\tName  string \`json:"name"\`\n\tExtra any    \`json:"extra"\`\n}\n\n`,
		),
	},
	"json-marshal": {
		"main.go": mainPkg(
			`\t"encoding/json"`,
			`\tb, err := json.Marshal(Config{Name: "a", Size: 3})\n\tif err != nil {\n\t\tpanic(err)\n\t}\n\tprintln(string(b))`,
			`type Config struct {\n\tName string \`json:"name"\`\n\tSize int    \`json:"size"\`\n}\n\n`,
		),
	},
	// Unused functions, types and methods of the entry package and of a local
	// package stay out of the bundle, and a user `Len`/`Reset` does not keep
	// the `strings.Builder` methods of the same name.
	"user-dce": {
		"main.go": `package main

import (
	"strings"
	"./util"
)

type Box struct{ n int }

func (b *Box) Used() int         { return b.n }
func (b *Box) UnusedMethod() int { return b.n * 2 }

type UnusedType struct{ s string }

func (u UnusedType) Describe() string { return u.s }

func UnusedUserFunction() string { return strings.Repeat("x", 3) }

type Counter struct{ n int }

func (c *Counter) Len() int { return c.n }
func (c *Counter) Reset()   { c.n = 0 }

func main() {
	var sb strings.Builder
	sb.WriteString("hi")
	c := &Counter{n: 2}
	c.Reset()
	b := &Box{n: 3}
	println(sb.String(), b.Used(), c.Len(), util.Used())
}
`,
		"util/util.go": `package util

import "strings"

func Used() int { return 1 }

func Unused() string { return strings.ToUpper("unused") }

type Pad struct{ w int }

func (p Pad) Width() int { return p.w }
`,
	},
	// Three packages: only cfg calls json.Marshal; world has structs and no JSON call.
	multipackage: {
		"main.go": mainPkg(
			`\t"./cfg"\n\t"./world"`,
			`\tprintln(cfg.Dump(cfg.Config{Name: "a"}), world.Count())`,
		),
		"cfg/cfg.go": `package cfg

import "encoding/json"

type Config struct {
	Name string \`json:"name"\`
}

func Dump(c Config) string {
	b, err := json.Marshal(c)
	if err != nil {
		panic(err)
	}
	return string(b)
}
`,
		"world/world.go": `package world

type Vec struct{ X, Y, Z float64 }

type Body struct {
	Pos, Vel Vec
	Mass     float64
}

type Scene struct {
	Bodies []Body
	Names  map[string]Body
}

func Count() int {
	s := Scene{Bodies: []Body{{Mass: 1}}}
	return len(s.Bodies)
}
`,
	},
};

// Builds one fixture with --release and returns the byte size of its app.js.
export function measureFixture(files, tmp) {
	const src = join(tmp, "src");
	for (const [path, source] of Object.entries(files)) {
		mkdirSync(dirname(join(src, path)), { recursive: true });
		writeFileSync(join(src, path), source);
	}
	const out = join(tmp, "out");
	const res = spawnSync(
		process.execPath,
		[join(ROOT, "src/index.js"), "build", src, "-o", out, "--release"],
		{ encoding: "utf8" },
	);
	if (res.status !== 0) {
		throw new Error(`build failed:\n${res.stderr || res.stdout}`);
	}
	return statSync(join(out, "app.js")).size;
}

// The key of an example's case in the baseline.
const exampleCase = (name) => `example-${name}`;

// Every case the budget covers: the fixtures and the example apps.
export function caseNames() {
	return [...Object.keys(FIXTURES), ...listExamples(ROOT).map(exampleCase)];
}

// Builds example `name` from its project directory (so a vendored import
// resolves as it does for its users) and returns the size of its app.js.
export function measureExample(name, tmp) {
	const out = join(tmp, "out");
	const res = spawnSync(
		process.execPath,
		[join(ROOT, "src/index.js"), "build", ".", "-o", out, "--release"],
		{ cwd: join(ROOT, "example", name), encoding: "utf8" },
	);
	if (res.status !== 0) {
		throw new Error(`build failed:\n${res.stderr || res.stdout}`);
	}
	return statSync(join(out, "app.js")).size;
}

export function measureAll() {
	const sizes = {};
	for (const [name, files] of Object.entries(FIXTURES)) {
		const tmp = mkdtempSync(join(tmpdir(), "gofront-size-"));
		try {
			sizes[name] = measureFixture(files, tmp);
		} catch (e) {
			throw new Error(`${name}: ${e.message}`);
		}
		rmSync(tmp, { recursive: true, force: true });
	}
	for (const name of listExamples(ROOT)) {
		const tmp = mkdtempSync(join(tmpdir(), "gofront-size-"));
		try {
			sizes[exampleCase(name)] = measureExample(name, tmp);
		} catch (e) {
			throw new Error(`${exampleCase(name)}: ${e.message}`);
		}
		rmSync(tmp, { recursive: true, force: true });
	}
	return sizes;
}

// Compares measured sizes with ceilings. Returns one message per violation:
// a fixture over its ceiling, a fixture without a ceiling, or a stale ceiling.
export function checkBudgets(sizes, ceilings) {
	const problems = [];
	for (const [name, bytes] of Object.entries(sizes)) {
		const ceiling = ceilings[name];
		if (ceiling === undefined) {
			problems.push(`${name}: no ceiling in bundle-size.baseline.json`);
		} else if (bytes > ceiling) {
			problems.push(
				`${name}: ${bytes} B exceeds its ceiling of ${ceiling} B (+${bytes - ceiling} B)`,
			);
		}
	}
	for (const name of Object.keys(ceilings)) {
		if (!(name in sizes)) problems.push(`${name}: ceiling has no fixture`);
	}
	return problems;
}

export function ceilingsFor(sizes) {
	return Object.fromEntries(
		Object.entries(sizes).map(([name, b]) => [name, Math.ceil(b * HEADROOM)]),
	);
}

function printTable(sizes, ceilings) {
	const width = Math.max(...Object.keys(sizes).map((n) => n.length));
	console.log(
		`${"fixture".padEnd(width)}  ${"bytes".padStart(9)}  ${"ceiling".padStart(9)}`,
	);
	for (const [name, bytes] of Object.entries(sizes)) {
		const c = ceilings[name];
		console.log(
			`${name.padEnd(width)}  ${String(bytes).padStart(9)}  ${String(c ?? "-").padStart(9)}`,
		);
	}
}

function main() {
	const arg = process.argv[2];

	if (arg === "--self-test") {
		// One fixture and one example, so both ways of building are exercised.
		const [fixture, files] = Object.entries(FIXTURES)[0];
		const [example] = listExamples(ROOT);
		const cases = {
			[fixture]: (tmp) => measureFixture(files, tmp),
			[exampleCase(example)]: (tmp) => measureExample(example, tmp),
		};
		for (const [name, measure] of Object.entries(cases)) {
			const tmp = mkdtempSync(join(tmpdir(), "gofront-size-"));
			let bytes;
			try {
				bytes = measure(tmp);
			} finally {
				rmSync(tmp, { recursive: true, force: true });
			}
			const sizes = { [name]: bytes };
			const problems = checkBudgets(sizes, { [name]: bytes - 1 });
			if (
				problems.length !== 1 ||
				!problems[0].includes(`${name}: ${bytes} B`)
			) {
				console.error(`self-test: expected one violation for ${name}, got:`);
				console.error(problems.join("\n") || "(none)");
				process.exit(1);
			}
			if (checkBudgets(sizes, { [name]: bytes }).length !== 0) {
				console.error("self-test: a ceiling equal to the size must pass");
				process.exit(1);
			}
			console.log(`bundle-size self-test ok: ${problems[0]}`);
		}
		return;
	}

	const sizes = measureAll();

	if (arg === "--update") {
		const ceilings = ceilingsFor(sizes);
		writeFileSync(BASELINE, `${JSON.stringify(ceilings, null, "\t")}\n`);
		printTable(sizes, ceilings);
		console.log(`wrote ${BASELINE}`);
		return;
	}

	const ceilings = JSON.parse(readFileSync(BASELINE, "utf8"));
	printTable(sizes, ceilings);
	const problems = checkBudgets(sizes, ceilings);
	if (problems.length > 0) {
		console.error(`\nbundle size budget failed:\n  ${problems.join("\n  ")}`);
		console.error(
			"If the growth is intended, run `node test/perf/bundle-size.js --update` and review the diff.",
		);
		process.exit(1);
	}
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
	main();
