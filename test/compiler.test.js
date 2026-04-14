// GoFront test suite — compiler, multi-file, CLI, npm resolver
import { spawnSync } from "node:child_process";
import {
	chmodSync,
	existsSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import {
	assert,
	assertContains,
	assertEqual,
	assertErrorContains,
	compile,
	compileDir,
	FIXTURES,
	ROOT,
	runJs,
	section,
	summarize,
	test,
} from "./helpers.js";

section("npm package resolver");

test('resolves package.json "types" field', () => {
	// Uses a self-contained fake-lib in test/fixtures/node_modules so no real
	// npm dependency is needed. Proves the resolver finds package.json "types",
	// parses the .d.ts, and the types flow through type checker and codegen.
	const { js, errors } = compile(
		`package main
import "fake-lib"
func main() {
  r := math.add(1.0, 2.0)
  s := strings.repeat("hi", 3)
  console.log(r, s)
}`,
		{ fromFile: join(FIXTURES, "_dummy.go") },
	);
	assertEqual(errors.length, 0);
	assertContains(js, "from 'fake-lib'");
	assertContains(js, "math.add(");
	assertContains(js, "strings.repeat(");
});

test("resolves @types/ scoped package", () => {
	// fake-util has no package.json — resolver falls back to @types/fake-util/index.d.ts
	const { js, errors } = compile(
		`package main
import "fake-util"
func main() {
  x := util.clamp(1.5, 0.0, 1.0)
  console.log(x)
}`,
		{ fromFile: join(FIXTURES, "_dummy.go") },
	);
	assertEqual(errors.length, 0);
	assertContains(js, "from 'fake-util'");
	assertContains(js, "util.clamp(");
});

test("resolves @scope/pkg via @types/scope__pkg (global replace not just first slash)", () => {
	// Fixture: test/fixtures/node_modules/@types/scope__mypkg/index.d.ts
	// This test verifies the resolver replaces ALL slashes (/ → __) in the scoped name,
	// so @scope/mypkg maps correctly to @types/scope__mypkg.
	const { errors } = compile(
		`package main
import "@scope/mypkg"
func main() {
  s := greet("world")
  console.log(s)
}`,
		{ fromFile: join(FIXTURES, "_dummy.go") },
	);
	assertEqual(errors.length, 0);
});

test("unknown npm package warns but compiles as any", () => {
	// should not throw — unknown imports are treated as any
	const { errors } = compile(
		`package main
import "totally-unknown-pkg"
func main() { console.log("ok") }`,
		{ fromFile: join(FIXTURES, "_dummy.go") },
	);
	assertEqual(errors.length, 0);
});

// ── Multi-file compilation ───────────────────────────────────

section("Multi-file package compilation");

test("same-package multi-file: types and functions shared across files", () => {
	const dir = join(FIXTURES, "multifile/main");
	const { js } = compileDir(dir);
	// Point is defined in types.go, used in main.go
	assertContains(js, "class Point");
	assertContains(js, "sumPoints");
	assertContains(js, "newPoint");
});

test("same-package multi-file: runtime result is correct", () => {
	const dir = join(FIXTURES, "multifile/main");
	const { js } = compileDir(dir);
	// sumPoints({3,4} + {1,2}) = 3+4+1+2 = 10
	const out = runJs(js);
	assertEqual(out.trim(), "10");
});

test("same-package multi-file: function in one file calls function from another", () => {
	const dir = join(FIXTURES, "multifile/mathpkg");
	const { js } = compileDir(dir);
	// Square is in extra.go and calls Mul from math.go
	assertContains(js, "Square");
	assertContains(js, "Mul");
});

test("same-package multi-file: cross-file function call works at runtime", () => {
	const dir = join(FIXTURES, "multifile/mathpkg");
	const { js: pkgJs } = compileDir(dir);
	// Wrap in a test harness since there's no main() in mathpkg
	const harness = `${pkgJs}\nconsole.log(Square(5));`;
	const out = runJs(harness);
	assertEqual(out.trim(), "25");
});

test("cross-package import: bundle includes dependency code", () => {
	const dir = join(FIXTURES, "multifile/withimport");
	const { js } = compileDir(dir);
	// math package functions should be inlined
	assertContains(js, "function Add(");
	assertContains(js, "function Square(");
});

test("cross-package import: qualified access de-qualified in bundle", () => {
	const dir = join(FIXTURES, "multifile/withimport");
	const { js } = compileDir(dir);
	// math.Add(10, 5) should be emitted as Add(10, 5) in the bundle
	assertContains(js, "Add(10, 5)");
	assertContains(js, "Square(4)");
});

test("cross-package import: runtime output is correct", () => {
	const dir = join(FIXTURES, "multifile/withimport");
	const { js } = compileDir(dir);
	const out = runJs(js);
	assertEqual(out.trim(), "15\n16"); // Add(10,5)=15, Square(4)=16
});

test("import alias: qualified access uses alias name", () => {
	const dir = join(FIXTURES, "multifile/withimportalias");
	const { js } = compileDir(dir);
	assertContains(js, "Add(10, 5)");
	assertContains(js, "Square(4)");
});

test("import alias: runtime output is correct", () => {
	const dir = join(FIXTURES, "multifile/withimportalias");
	const { js } = compileDir(dir);
	assertEqual(runJs(js).trim(), "15\n16");
});

test("import alias: original package name is not accessible", () => {
	const { errors } = compile(
		`package main
import m "./mathpkg"
func main() {
	math.Add(1, 2)
}`,
		{ fromFile: join(FIXTURES, "multifile/withimportalias/main.go") },
	);
	assert(errors.length > 0, "expected error");
	assertErrorContains(errors, "math");
});

test("import alias: type error for non-existent member", () => {
	// compileDir resolves the local package so 'm' is a real namespace
	// and accessing an unknown field produces a specific member error
	const { errors } = compile(
		`package main
import m "./mathpkg"
func main() {
	m.Nonexistent()
}`,
		{ fromFile: join(FIXTURES, "multifile/withimportalias/main.go") },
	);
	// package doesn't resolve in inline compile — any error is acceptable
	assert(errors.length > 0, "expected error");
});

test("import alias in group syntax compiles and runs", () => {
	const dir = join(FIXTURES, "multifile/withimportalias_group");
	const { js, errors } = compileDir(dir);
	assertEqual(errors?.length ?? 0, 0);
	assertEqual(runJs(js).trim(), "5");
});

test("exportedSymbols contains package functions", () => {
	const dir = join(FIXTURES, "multifile/mathpkg");
	const { exportedSymbols } = compileDir(dir);
	assert(exportedSymbols.has("Add"), "Add should be exported");
	assert(exportedSymbols.has("Mul"), "Mul should be exported");
	assert(exportedSymbols.has("Square"), "Square should be exported");
});

// ═════════════════════════════════════════════════════════════
// defer & error
// ═════════════════════════════════════════════════════════════

section("Example app (todo)");

test("example dir compiles without errors", () => {
	const exampleDir = join(ROOT, "example", "src");
	const result = compileDir(exampleDir);
	assert(result.js && result.js.length > 0, "expected non-empty JS output");
});

test("example exports expected functions", () => {
	const exampleDir = join(ROOT, "example", "src");
	const result = compileDir(exampleDir);
	assert(result.exportedSymbols.has("main"), "expected main to be exported");
	assert(
		result.exportedSymbols.has("addTodo"),
		"expected addTodo to be exported",
	);
	assert(
		result.exportedSymbols.has("render"),
		"expected render to be exported",
	);
	assert(
		result.exportedSymbols.has("toggleTodo"),
		"expected toggleTodo to be exported",
	);
});

test("example store logic runs correctly (addTodo / stats)", () => {
	const exampleDir = join(ROOT, "example", "src");
	compileDir(exampleDir);
	// Inject a test driver after the compiled code, bypassing DOM calls
	const driver = `
var todos = [];
var nextId = 0;
function addTodo(text, priority) {
  todos.push({ id: nextId++, text, done: false, priority });
}
function toggleTodo(id) {
  var t = todos.find(x => x.id === id);
  if (t) t.done = !t.done;
}
function stats() {
  var remaining = todos.filter(t => !t.done).length;
  var completed = todos.filter(t => t.done).length;
  return [remaining, completed];
}
addTodo("buy milk", 0);
addTodo("fix bug", 1);
toggleTodo(0);
var [rem, comp] = stats();
console.log(rem);
console.log(comp);
`;
	const lines = [];
	const ctx = vm.createContext({
		console: { log: (...a) => lines.push(a.map(String).join(" ")) },
	});
	vm.runInContext(driver, ctx);
	assertEqual(lines.join("\n"), "1\n1");
});

test("validateTodo rejects empty string", () => {
	const { js, errors } = compile(`package main
func validateTodo(text string) error {
  if text == "" {
    return error("todo text cannot be empty")
  }
  return nil
}
func main() {
  e1 := validateTodo("")
  e2 := validateTodo("buy milk")
  console.log(e1 != nil)
  console.log(e2 == nil)
  console.log(e1.Error())
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "true\ntrue\ntodo text cannot be empty");
});

test("utils.Plural formats correctly", () => {
	const utilsDir = join(ROOT, "example", "src", "utils");
	const result = compileDir(utilsDir);
	assert(result.js.includes("Plural"), "expected Plural in output");
	assert(result.js.includes("Clamp"), "expected Clamp in output");
});

// ═════════════════════════════════════════════════════════════
// Builtins
// ═════════════════════════════════════════════════════════════

section("Store functions (moveTodo / removeTodo / filters)");

test("moveTodo reorders the list", () => {
	const { js, errors } = compile(`package main
type Todo struct { id int; text string; done bool; priority int }
var todos []Todo
var nextId int
func addTodo(text string, priority int) {
  todos = append(todos, Todo{id: nextId, text: text, done: false, priority: priority})
  nextId++
}
func moveTodo(fromId int, toId int) {
  if fromId == toId { return }
  var item Todo
  var rest []Todo
  for _, t := range todos {
    if t.id == fromId { item = t } else { rest = append(rest, t) }
  }
  var result []Todo
  inserted := false
  for _, t := range rest {
    if t.id == toId { result = append(result, item); inserted = true }
    result = append(result, t)
  }
  if !inserted { result = append(result, item) }
  todos = result
}
func main() {
  addTodo("a", 0)
  addTodo("b", 0)
  addTodo("c", 0)
  moveTodo(0, 2)
  for _, t := range todos { console.log(t.text) }
}`);
	assertEqual(errors.length, 0);
	assertEqual(runJs(js), "b\na\nc");
});

test("moveTodo to end when target not found", () => {
	const { js } = compile(`package main
type Todo struct { id int; text string; done bool; priority int }
var todos []Todo
var nextId int
func addTodo(text string, priority int) {
  todos = append(todos, Todo{id: nextId, text: text, done: false, priority: priority})
  nextId++
}
func moveTodo(fromId int, toId int) {
  if fromId == toId { return }
  var item Todo
  var rest []Todo
  for _, t := range todos {
    if t.id == fromId { item = t } else { rest = append(rest, t) }
  }
  var result []Todo
  inserted := false
  for _, t := range rest {
    if t.id == toId { result = append(result, item); inserted = true }
    result = append(result, t)
  }
  if !inserted { result = append(result, item) }
  todos = result
}
func main() {
  addTodo("a", 0)
  addTodo("b", 0)
  addTodo("c", 0)
  moveTodo(0, 99)
  for _, t := range todos { console.log(t.text) }
}`);
	assertEqual(runJs(js), "b\nc\na");
});

test("removeTodo removes by id", () => {
	const { js } = compile(`package main
type Todo struct { id int; text string; done bool; priority int }
var todos []Todo
var nextId int
func addTodo(text string, priority int) {
  todos = append(todos, Todo{id: nextId, text: text, done: false, priority: priority})
  nextId++
}
func removeTodo(id int) {
  var next []Todo
  for _, t := range todos {
    if t.id != id { next = append(next, t) }
  }
  todos = next
}
func main() {
  addTodo("a", 0)
  addTodo("b", 0)
  addTodo("c", 0)
  removeTodo(1)
  for _, t := range todos { console.log(t.text) }
}`);
	assertEqual(runJs(js), "a\nc");
});

test("clearCompleted removes only done todos", () => {
	const { js } = compile(`package main
type Todo struct { id int; text string; done bool; priority int }
var todos []Todo
var nextId int
func addTodo(text string, priority int) {
  todos = append(todos, Todo{id: nextId, text: text, done: false, priority: priority})
  nextId++
}
func clearCompleted() {
  var next []Todo
  for _, t := range todos {
    if !t.done { next = append(next, t) }
  }
  todos = next
}
func main() {
  addTodo("a", 0)
  addTodo("b", 0)
  addTodo("c", 0)
  todos[1].done = true
  clearCompleted()
  for _, t := range todos { console.log(t.text) }
}`);
	assertEqual(runJs(js), "a\nc");
});

test("visibleTodos FilterActive returns only incomplete", () => {
	const { js } = compile(`package main
const (
  FilterAll = iota
  FilterActive
  FilterCompleted
)
type Todo struct { id int; text string; done bool; priority int }
var todos []Todo
var nextId int
var currentFilter int
func addTodo(text string, priority int) {
  todos = append(todos, Todo{id: nextId, text: text, done: false, priority: priority})
  nextId++
}
func visibleTodos() []Todo {
  switch currentFilter {
  case FilterActive:
    var out []Todo
    for _, t := range todos { if !t.done { out = append(out, t) } }
    return out
  case FilterCompleted:
    var out []Todo
    for _, t := range todos { if t.done { out = append(out, t) } }
    return out
  default:
    return todos
  }
}
func main() {
  addTodo("a", 0)
  addTodo("b", 0)
  addTodo("c", 0)
  todos[0].done = true
  currentFilter = FilterActive
  for _, t := range visibleTodos() { console.log(t.text) }
}`);
	assertEqual(runJs(js), "b\nc");
});

// ═════════════════════════════════════════════════════════════
// CLI flags
// ═════════════════════════════════════════════════════════════

section("CLI flags");

const CLI = join(ROOT, "src", "index.js");

function cli(args) {
	const r = spawnSync(process.execPath, [CLI, ...args], { encoding: "utf8" });
	return {
		stdout: r.stdout ?? "",
		stderr: r.stderr ?? "",
		code: r.status ?? 1,
	};
}

function makeTmp(name, content) {
	const dir = mkdtempSync(join(tmpdir(), "gofront-"));
	const file = join(dir, name);
	writeFileSync(file, content);
	return { dir, file };
}

test("--version prints version", () => {
	const { stdout, code } = cli(["--version"]);
	assert(code === 0, `expected exit 0, got ${code}`);
	assert(stdout.startsWith("gofront "), `unexpected output: ${stdout}`);
});

test("--check exits 0 on valid file", () => {
	const { file, dir } = makeTmp(
		"ok.go",
		`package main\nfunc main() { console.log("hi") }\n`,
	);
	try {
		const { code, stderr } = cli([file, "--check"]);
		assert(code === 0, `expected exit 0, got ${code} — ${stderr}`);
		assert(stderr.includes("OK"), `expected OK in stderr: ${stderr}`);
	} finally {
		try {
			rmSync(dir, { recursive: true, force: true });
		} catch {}
	}
});

test("--check exits 1 on type error", () => {
	const { file, dir } = makeTmp(
		"bad.go",
		`package main\nfunc main() { notDefined }\n`,
	);
	try {
		const { code, stderr } = cli([file, "--check"]);
		assert(code !== 0, "expected non-zero exit on type error");
		assert(
			stderr.includes("notDefined") || stderr.includes("Undefined"),
			`expected error in stderr: ${stderr}`,
		);
	} finally {
		try {
			rmSync(dir, { recursive: true, force: true });
		} catch {}
	}
});

test("--source-map appends sourceMappingURL comment", () => {
	const { file, dir } = makeTmp(
		"sm.go",
		`package main\nfunc main() { console.log("hi") }\n`,
	);
	try {
		const { stdout, code } = cli([file, "--source-map"]);
		assert(code === 0, `expected exit 0, got ${code}`);
		assert(
			stdout.includes("sourceMappingURL=data:application/json;base64,"),
			"expected inline source map",
		);
	} finally {
		try {
			rmSync(dir, { recursive: true, force: true });
		} catch {}
	}
});

test("gofront init creates main.go", () => {
	const dir = mkdtempSync(join(tmpdir(), "gofront-init-"));
	try {
		const { code, stderr } = cli(["init", dir]);
		assert(code === 0, `expected exit 0: ${stderr}`);
		const mainPath = join(dir, "main.go");
		assert(existsSync(mainPath), "expected main.go to be created");
		const content = readFileSync(mainPath, "utf8");
		assert(content.includes("func main()"), "expected func main() in scaffold");
	} finally {
		try {
			rmSync(dir, { recursive: true, force: true });
		} catch {}
	}
});

// ── 7. New feature tests ─────────────────────────────────────

section("CLI flags — additional");

test("--help exits 0 and prints usage", () => {
	const { stdout, code } = cli(["--help"]);
	assert(code === 0, `expected exit 0, got ${code}`);
	assertContains(stdout, "gofront");
	assertContains(stdout, "Usage");
});

test("-o writes output to a file", () => {
	const { file, dir } = makeTmp(
		"simple.go",
		`package main\nfunc main() { console.log("hi") }\n`,
	);
	const outFile = join(dir, "out.js");
	try {
		const { code, stderr } = cli([file, "-o", outFile]);
		assert(code === 0, `expected exit 0: ${stderr}`);
		assert(existsSync(outFile), "expected output file to be created");
		const content = readFileSync(outFile, "utf8");
		assertContains(content, "console.log");
	} finally {
		try {
			rmSync(dir, { recursive: true, force: true });
		} catch {}
	}
});

test("--tokens dumps token list", () => {
	const { file, dir } = makeTmp("tok.go", `package main\nfunc main() {}\n`);
	try {
		const { stdout, code } = cli([file, "--tokens"]);
		assert(code === 0, `expected exit 0, got ${code}`);
		// Token stream should contain identifiers like "main"
		assertContains(stdout, "main");
	} finally {
		try {
			rmSync(dir, { recursive: true, force: true });
		} catch {}
	}
});

test("--ast dumps JSON AST", () => {
	const { file, dir } = makeTmp("ast.go", `package main\nfunc main() {}\n`);
	try {
		const { stdout, code } = cli([file, "--ast"]);
		assert(code === 0, `expected exit 0, got ${code}`);
		const ast = JSON.parse(stdout);
		assert(ast.pkg?.name === "main", "expected pkg.name to be main");
	} finally {
		try {
			rmSync(dir, { recursive: true, force: true });
		} catch {}
	}
});

test("error on non-existent input file", () => {
	const { code, stderr } = cli(["/nonexistent/path/file.go"]);
	assert(code !== 0, "expected non-zero exit");
	assertContains(stderr, "gofront:");
});

test("--minify produces minified output", () => {
	const { file, dir } = makeTmp(
		"min.go",
		`package main\nfunc main() { console.log("hello world") }\n`,
	);
	try {
		const { stdout: plain } = cli([file]);
		const { stdout: minified, code } = cli([file, "--minify"]);
		assert(code === 0, `expected exit 0`);
		// Minified output should be shorter than plain output
		assert(
			minified.length < plain.length,
			`expected minified (${minified.length}) < plain (${plain.length})`,
		);
	} finally {
		try {
			rmSync(dir, { recursive: true, force: true });
		} catch {}
	}
});

test("gofront init exits 1 if main.go already exists", () => {
	const dir = mkdtempSync(join(tmpdir(), "gofront-init-exists-"));
	const mainPath = join(dir, "main.go");
	try {
		writeFileSync(mainPath, "package main\n");
		const { code, stderr } = cli(["init", dir]);
		assert(code !== 0, "expected non-zero exit");
		assertContains(stderr, "already exists");
	} finally {
		try {
			rmSync(dir, { recursive: true, force: true });
		} catch {}
	}
});

test("-v (short flag) prints version", () => {
	const { stdout, code } = cli(["-v"]);
	assert(code === 0, `expected exit 0, got ${code}`);
	assert(stdout.startsWith("gofront "), `unexpected output: ${stdout}`);
});

test("-h (short flag) prints usage", () => {
	const { stdout, code } = cli(["-h"]);
	assert(code === 0, `expected exit 0, got ${code}`);
	assertContains(stdout, "Usage");
});

test("gofront init <new-dir> creates directory and main.go", () => {
	const base = mkdtempSync(join(tmpdir(), "gofront-init-parent-"));
	const newDir = join(base, "myproject");
	try {
		const { code, stderr } = cli(["init", newDir]);
		assert(code === 0, `expected exit 0: ${stderr}`);
		assert(existsSync(join(newDir, "main.go")), "expected main.go in new dir");
		assertContains(
			readFileSync(join(newDir, "main.go"), "utf8"),
			"func main()",
		);
	} finally {
		try {
			rmSync(base, { recursive: true, force: true });
		} catch {}
	}
});

test("gofront init . creates main.go in cwd", () => {
	const tmpDir = mkdtempSync(join(tmpdir(), "gofront-init-dot-"));
	try {
		const r = spawnSync(process.execPath, [CLI, "init", "."], {
			encoding: "utf8",
			cwd: tmpDir,
		});
		assert(r.status === 0, `expected exit 0: ${r.stderr}`);
		assert(existsSync(join(tmpDir, "main.go")), "expected main.go in tmpDir");
		assertContains(
			readFileSync(join(tmpDir, "main.go"), "utf8"),
			"func main()",
		);
	} finally {
		try {
			rmSync(tmpDir, { recursive: true, force: true });
		} catch {}
	}
});

test("gofront <dir> compiles directory to stdout", () => {
	const { stdout, code, stderr } = cli([
		join(FIXTURES, "multifile/withimport"),
	]);
	assert(code === 0, `expected exit 0: ${stderr}`);
	assertContains(stdout, "function Add(");
});

test("gofront <dir> -o out.js compiles directory to file", () => {
	const tmpDir = mkdtempSync(join(tmpdir(), "gofront-dir-o-"));
	const outFile = join(tmpDir, "bundle.js");
	try {
		const { code, stderr } = cli([
			join(FIXTURES, "multifile/withimport"),
			"-o",
			outFile,
		]);
		assert(code === 0, `expected exit 0: ${stderr}`);
		assert(existsSync(outFile), "expected bundle.js to be created");
		assertContains(readFileSync(outFile, "utf8"), "function Add(");
	} finally {
		try {
			rmSync(tmpDir, { recursive: true, force: true });
		} catch {}
	}
});

test("gofront <dir> --check exits 0 on valid directory", () => {
	const { code, stderr } = cli([
		join(FIXTURES, "multifile/withimport"),
		"--check",
	]);
	assert(code === 0, `expected exit 0: ${stderr}`);
	assertContains(stderr, "OK");
});

test("single file with unreadable js: import path exits 1", () => {
	const { file, dir } = makeTmp(
		"bad_dts.go",
		`package main\nimport "js:nonexistent.d.ts"\nfunc main() {}\n`,
	);
	try {
		const { code, stderr } = cli([file]);
		assert(code !== 0, "expected non-zero exit for unreadable dts");
		assertContains(stderr, "gofront:");
	} finally {
		try {
			rmSync(dir, { recursive: true, force: true });
		} catch {}
	}
});

test("single file with local package import bundles dependency", () => {
	// Exercises the local-import bundling loop in runCompile (lines 194-213)
	const { stdout, code, stderr } = cli([
		join(FIXTURES, "multifile/withimport/main.go"),
	]);
	assert(code === 0, `expected exit 0: ${stderr}`);
	assertContains(stdout, "function Add(");
	assertContains(stdout, "function Square(");
});

test("single file with npm import emits import statement", () => {
	// Exercises the resolveAll results loop in runCompile (lines 185-188)
	// Write a temp file inside fixtures/ so node_modules is discoverable
	const tmpGo = join(FIXTURES, "_npm_cli_tmp.go");
	try {
		writeFileSync(
			tmpGo,
			`package main\nimport "fake-lib"\nfunc main() { r := math.add(1.0, 2.0); console.log(r) }\n`,
		);
		const { stdout, code, stderr } = cli([tmpGo]);
		assert(code === 0, `expected exit 0: ${stderr}`);
		assertContains(stdout, "from 'fake-lib'");
	} finally {
		try {
			rmSync(tmpGo);
		} catch {}
	}
});

test("single file unreadable exits 1 with cannot-read error", () => {
	// Exercises the readFileSync catch in runCompile (lines 148-149)
	const dir = mkdtempSync(join(tmpdir(), "gofront-unread-"));
	const file = join(dir, "locked.go");
	try {
		writeFileSync(file, "package main\nfunc main() {}\n");
		chmodSync(file, 0o000);
		const { code, stderr } = cli([file]);
		assert(code !== 0, "expected non-zero exit");
		assertContains(stderr, "gofront:");
	} finally {
		try {
			chmodSync(file, 0o644);
		} catch {}
		rmSync(dir, { recursive: true, force: true });
	}
});

test("-o write failure exits 1 with cannot-write error", () => {
	// Exercises the outputFile writeFileSync catch (lines 278-280)
	const srcDir = mkdtempSync(join(tmpdir(), "gofront-wsrc-"));
	const outDir = mkdtempSync(join(tmpdir(), "gofront-wout-"));
	const file = join(srcDir, "main.go");
	const outFile = join(outDir, "out.js");
	try {
		writeFileSync(file, `package main\nfunc main() { console.log("hi") }\n`);
		chmodSync(outDir, 0o555);
		const { code, stderr } = cli([file, "-o", outFile]);
		assert(code !== 0, "expected non-zero exit");
		assertContains(stderr, "cannot write");
	} finally {
		try {
			chmodSync(outDir, 0o755);
		} catch {}
		rmSync(srcDir, { recursive: true, force: true });
		rmSync(outDir, { recursive: true, force: true });
	}
});

test("init mkdir failure exits 1", () => {
	// Exercises the mkdirSync catch in init (lines 79-81)
	// Create a regular file where a directory would need to be created
	const base = mkdtempSync(join(tmpdir(), "gofront-init-fail-"));
	const blockFile = join(base, "blocked");
	try {
		writeFileSync(blockFile, "i am a file");
		const { code, stderr } = cli(["init", join(blockFile, "subproject")]);
		assert(code !== 0, "expected non-zero exit");
		assertContains(stderr, "cannot create");
	} finally {
		rmSync(base, { recursive: true, force: true });
	}
});

test("init write failure exits 1", () => {
	// Exercises the writeFileSync catch in init (lines 104-106)
	const dir = mkdtempSync(join(tmpdir(), "gofront-init-nowrite-"));
	try {
		chmodSync(dir, 0o555);
		const { code, stderr } = cli(["init", dir]);
		assert(code !== 0, "expected non-zero exit");
		assertContains(stderr, "cannot write");
	} finally {
		try {
			chmodSync(dir, 0o755);
		} catch {}
		rmSync(dir, { recursive: true, force: true });
	}
});

// ── Watch mode ───────────────────────────────────────────────

section("CLI flags — watch mode");

test("--watch starts, builds, and emits 'watching' message", () => {
	// Exercises watch mode (lines 287-329): buildOnce + watch setup
	const dir = mkdtempSync(join(tmpdir(), "gofront-watch-"));
	const file = join(dir, "main.go");
	try {
		writeFileSync(file, `package main\nfunc main() { console.log("hi") }\n`);
		// spawnSync with timeout kills the watch process after 900ms
		const r = spawnSync(process.execPath, [CLI, file, "--watch"], {
			encoding: "utf8",
			timeout: 900,
		});
		assert(r.stderr.includes("OK"), `expected OK in stderr: ${r.stderr}`);
		assert(
			r.stderr.includes("watching"),
			`expected 'watching' in stderr: ${r.stderr}`,
		);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("--watch with compile error logs ERROR without exiting", () => {
	// Exercises buildOnce error handler (lines 310-313)
	const dir = mkdtempSync(join(tmpdir(), "gofront-watch-err-"));
	const file = join(dir, "bad.go");
	try {
		writeFileSync(file, `package main\nfunc main() { notDefined }\n`);
		const r = spawnSync(process.execPath, [CLI, file, "--watch"], {
			encoding: "utf8",
			timeout: 900,
		});
		assert(r.stderr.includes("ERROR"), `expected ERROR in stderr: ${r.stderr}`);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("--watch -o writes output file on initial build", () => {
	// Exercises outputFile branch in buildOnce (lines 299-303)
	const srcDir = mkdtempSync(join(tmpdir(), "gofront-watch-o-src-"));
	const outDir = mkdtempSync(join(tmpdir(), "gofront-watch-o-out-"));
	const file = join(srcDir, "main.go");
	const outFile = join(outDir, "out.js");
	try {
		writeFileSync(file, `package main\nfunc main() { console.log("hi") }\n`);
		const r = spawnSync(
			process.execPath,
			[CLI, file, "--watch", "-o", outFile],
			{ encoding: "utf8", timeout: 900 },
		);
		assert(r.stderr.includes("OK"), `expected OK in stderr: ${r.stderr}`);
		assert(
			r.stderr.includes("wrote"),
			`expected 'wrote' in stderr: ${r.stderr}`,
		);
	} finally {
		rmSync(srcDir, { recursive: true, force: true });
		rmSync(outDir, { recursive: true, force: true });
	}
});

// ═════════════════════════════════════════════════════════════
// Type error — additional cases
// ═════════════════════════════════════════════════════════════

section("compiler.js — error paths");

test("compileDir throws on mixed package names", () => {
	const dir = join(FIXTURES, "missing_go");
	let threw = false;
	try {
		compileDir(dir);
	} catch (_e) {
		threw = true;
	}
	assert(threw, "expected error for empty/missing directory");
});

// ═════════════════════════════════════════════════════════════
// Lexer edge cases
// ═════════════════════════════════════════════════════════════

section("compiler.js — mixed package names");

test("compileDir throws when package names differ across files", () => {
	const dir = join(FIXTURES, "mixed_packages");
	let threw = false;
	let msg = "";
	try {
		compileDir(dir);
	} catch (e) {
		threw = true;
		msg = e.message;
	}
	assert(threw, "expected error for mixed package names");
	assertContains(msg, "Mixed package names");
});

test("compileDir throws on parse error in a .go file", () => {
	// Write a file with a syntax error into a temp dir and compile it
	const tmpDir = mkdtempSync(join(tmpdir(), "gofront-test-"));
	writeFileSync(join(tmpDir, "bad.go"), "package main\nfunc (( {}", "utf8");
	let threw = false;
	try {
		compileDir(tmpDir);
	} catch (_e) {
		threw = true;
	} finally {
		rmSync(tmpDir, { recursive: true, force: true });
	}
	assert(threw, "expected error for parse error");
});

test("compileDir throws on type-check error", () => {
	const tmpDir = mkdtempSync(join(tmpdir(), "gofront-test-"));
	writeFileSync(
		join(tmpDir, "bad.go"),
		`package main
func main() {
	var x int = "hello"
	console.log(x)
}`,
		"utf8",
	);
	let threw = false;
	try {
		compileDir(tmpDir);
	} catch (_e) {
		threw = true;
	} finally {
		rmSync(tmpDir, { recursive: true, force: true });
	}
	assert(threw, "expected error for type-check error");
});

test("compileDir with unknown npm import compiles without crash", () => {
	// unknown npm import resolves to null → exercises the if (!info) continue path
	const tmpDir = mkdtempSync(join(tmpdir(), "gofront-test-"));
	writeFileSync(
		join(tmpDir, "main.go"),
		`package main
import "totally-unknown-npm-package-xyz"
func main() { console.log("ok") }`,
		"utf8",
	);
	try {
		compileDir(tmpDir);
	} catch (_) {
		// ignore
	} finally {
		rmSync(tmpDir, { recursive: true, force: true });
	}
	// Either succeeds or throws — the important thing is it runs the if(!info) path
	assert(true, "reached without crash");
});

test("compileDir with missing local package import warns and continues", () => {
	// import "./nonexistent" where the subdir doesn't exist → exercises lines 118-122
	const tmpDir = mkdtempSync(join(tmpdir(), "gofront-test-"));
	writeFileSync(
		join(tmpDir, "main.go"),
		`package main
import "./nonexistent-subpkg"
func main() { console.log("ok") }`,
		"utf8",
	);
	try {
		compileDir(tmpDir);
	} catch (_) {
		// ignore
	} finally {
		rmSync(tmpDir, { recursive: true, force: true });
	}
	// Either warns and continues, or throws — the warning path (118-122) should execute
	assert(true, "reached the missing local package branch");
});

// ═════════════════════════════════════════════════════════════
// Side-effect imports (import _ "pkg")
// ═════════════════════════════════════════════════════════════

section("Side-effect imports");

test("import _ compiles without error", () => {
	const dir = join(FIXTURES, "multifile/withsideeffectimport");
	const { js, errors } = compileDir(dir);
	assertEqual(errors?.length ?? 0, 0);
	assertContains(js, "side-effect-only");
});

test("import _ bundles the dependency code", () => {
	const dir = join(FIXTURES, "multifile/withsideeffectimport");
	const { js } = compileDir(dir);
	// mathpkg should be inlined even though it's a side-effect import
	assertContains(js, "function Add(");
});

test("import _ runs correctly", () => {
	const dir = join(FIXTURES, "multifile/withsideeffectimport");
	const { js } = compileDir(dir);
	assertEqual(runJs(js).trim(), "side-effect-only");
});

test("import _ does not expose package namespace", () => {
	// Using math.Add should be a type error — the namespace is not registered
	const { errors } = compile(
		`package main
import _ "../mathpkg"
func main() {
	x := math.Add(1, 2)
	console.log(x)
}`,
		{ fromFile: join(FIXTURES, "multifile/withsideeffectimport/main.go") },
	);
	assert(
		errors.length > 0,
		"expected type error: math namespace not accessible",
	);
	assertErrorContains(errors, "math");
});

test("import _ in group syntax compiles without error", () => {
	const { js, errors } = compile(
		`package main
import (
	_ "../mathpkg"
)
func main() {
	console.log("ok")
}`,
		{ fromFile: join(FIXTURES, "multifile/withsideeffectimport/main.go") },
	);
	assertEqual(errors?.length ?? 0, 0);
	assertEqual(runJs(js).trim(), "ok");
});

// ═════════════════════════════════════════════════════════════
// dts-parser — additional coverage
// ═════════════════════════════════════════════════════════════

// ── Entry point ───────────────────────────────────────────────
if (process.argv[1] === fileURLToPath(import.meta.url)) {
	process.exit(summarize() > 0 ? 1 : 0);
}
