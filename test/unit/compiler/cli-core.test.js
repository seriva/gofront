// GoFront test suite — cli-core direct-import tests

import {
	chmodSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
	formatBuildSummary,
	formatPrepSummary,
	formatWrittenDesc,
	handleBuild,
	handleCheck,
	handleDev,
	handleInit,
	handleTest,
	maybeMinify,
	parseBuildArgs,
	parseCheckArgs,
	parseDevArgs,
	parseLegacyArgs,
	parsePrepArgs,
	parseTargetFlag,
	parseTestArgs,
	resolveAssetExtensions,
	runCompile,
	runSingleShot,
	writeCompileOutput,
} from "../../../src/cli-core.js";
import {
	colorEnabled,
	createColors,
	formatDiagnostic,
	log,
	ms,
	stamp,
} from "../../../src/colors.js";
import {
	clearParseCache,
	compileDir as compileDirCached,
	parseCacheSize,
} from "../../../src/compiler.js";
import {
	assert,
	assertContains,
	assertEqual,
	assertRejects,
	assertThrows,
	FIXTURES,
	section,
	summarize,
	test,
	withTempDir,
} from "../helpers.js";

section("cli-core — runCompile");

test("runCompile single file returns js string", () => {
	const dir = mkdtempSync(join(tmpdir(), "gofront-cc-"));
	const file = join(dir, "main.go");
	writeFileSync(file, `package main\nfunc main() { console.log("hi") }\n`);
	try {
		const result = runCompile(file, false, {});
		assert(typeof result.js === "string", "expected js string");
		assertContains(result.js, "console.log");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("runCompile directory bundles package", () => {
	const result = runCompile(join(FIXTURES, "multifile/withimport"), true, {});
	assert(typeof result.js === "string", "expected js string");
	assertContains(result.js, "function Add(");
});

test("runCompile single file with sourceMap appends sourceMappingURL", () => {
	const dir = mkdtempSync(join(tmpdir(), "gofront-cc-sm-"));
	const file = join(dir, "main.go");
	writeFileSync(file, `package main\nfunc main() { console.log("hi") }\n`);
	try {
		const result = runCompile(file, false, { sourceMap: true, outputDir: dir });
		assertContains(result.js, "sourceMappingURL=data:application/json;base64,");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("wasm packages with sourceMap write a function-level app.wasm.map", () => {
	const dir = mkdtempSync(join(tmpdir(), "gofront-cc-wsm-"));
	writeFileSync(
		join(dir, "m.go"),
		`//gofront:target wasm
package main

func Add(a, b int) int { return a + b }

func Mul(a, b int) int {
	f := func(x int) int { return x * b }
	return f(a)
}

func main() {}
`,
	);
	const out = join(dir, "out", "app.js");
	try {
		const result = runCompile(dir, true, { sourceMap: true, outputFile: out });
		writeCompileOutput(out, result);
		const mapFile = join(dir, "out", "app.wasm.map");
		assert(existsSync(mapFile), "expected app.wasm.map");
		const map = JSON.parse(readFileSync(mapFile, "utf8"));
		assertEqual(map.version, 3);
		assertEqual(map.sources.join(), "../m.go");
		// One segment per function with a source position: Add, Mul, main and
		// the lifted closure (generated line 0, column = byte offset).
		assertEqual(map.mappings.split(",").length, 4);
		assert(
			!map.mappings.includes(";"),
			"wasm maps use a single generated line",
		);
		const wasm = readFileSync(join(dir, "out", "app.wasm"));
		assert(
			wasm.includes(Buffer.from("sourceMappingURL")),
			"module must carry a sourceMappingURL custom section",
		);
		assert(WebAssembly.validate(wasm), "module must validate");

		// Without --source-map the map is removed again and no URL section is emitted.
		const plain = runCompile(dir, true, { outputFile: out });
		writeCompileOutput(out, plain);
		assert(!existsSync(mapFile), "stale app.wasm.map must be removed");
		assert(
			!readFileSync(join(dir, "out", "app.wasm")).includes(
				Buffer.from("sourceMappingURL"),
			),
		);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("runCompile throws on type error", () => {
	const dir = mkdtempSync(join(tmpdir(), "gofront-cc-te-"));
	const file = join(dir, "bad.go");
	writeFileSync(file, `package main\nfunc main() { notDefined }\n`);
	try {
		let threw = false;
		try {
			runCompile(file, false, {});
		} catch (e) {
			threw = true;
			assertContains(e.message, "notDefined");
		}
		assert(threw, "expected runCompile to throw on type error");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("runCompile throws on unreadable file", () => {
	const dir = mkdtempSync(join(tmpdir(), "gofront-cc-unread-"));
	const file = join(dir, "locked.go");
	writeFileSync(file, "package main\nfunc main() {}\n");
	chmodSync(file, 0o000);
	let threw = false;
	try {
		runCompile(file, false, {});
	} catch {
		threw = true;
	} finally {
		try {
			chmodSync(file, 0o644);
		} catch {}
		rmSync(dir, { recursive: true, force: true });
	}
	assert(threw, "expected runCompile to throw on unreadable file");
});

test("runCompile with dumpTokens returns tokens array", () => {
	const dir = mkdtempSync(join(tmpdir(), "gofront-cc-tok-"));
	const file = join(dir, "main.go");
	writeFileSync(file, `package main\nfunc main() {}\n`);
	try {
		const result = runCompile(file, false, { dumpTokens: true });
		assert(Array.isArray(result.tokens), "expected tokens array");
		assert(result.tokens.length > 0, "expected non-empty tokens");
		assert(result.js === undefined, "expected no js when dumpTokens");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("runCompile with dumpAst returns ast object", () => {
	const dir = mkdtempSync(join(tmpdir(), "gofront-cc-ast-"));
	const file = join(dir, "main.go");
	writeFileSync(file, `package main\nfunc main() {}\n`);
	try {
		const result = runCompile(file, false, { dumpAst: true });
		assert(result.ast !== undefined, "expected ast object");
		assert(result.ast.pkg?.name === "main", "expected pkg.name main");
		assert(result.js === undefined, "expected no js when dumpAst");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

section("cli-core — maybeMinify");

test("maybeMinify returns js unchanged when minify false", () => {
	const js = "function hello() { return 42; }";
	const result = maybeMinify(js, { minify: false });
	assert(result === js, "expected unchanged output");
});

test("maybeMinify returns shorter output when minify true", () => {
	const js = `function hello() {\n  return 42;\n}\nhello();\n`;
	const result = maybeMinify(js, { minify: true });
	assert(result.length < js.length, "expected shorter minified output");
});

test("maybeMinify throws when sourceMap and minify both true", () => {
	let threw = false;
	try {
		maybeMinify("function x() {}", { minify: true, sourceMap: true });
	} catch (e) {
		threw = true;
		assertContains(e.message, "cannot be used together");
	}
	assert(threw, "expected throw for sourceMap+minify combination");
});

test("maybeMinify with mangle produces shorter output", () => {
	const js = `function longFunctionName() { return longFunctionName; }\nlongFunctionName();\n`;
	const plain = maybeMinify(js, { minify: true, mangle: false });
	const mangled = maybeMinify(js, { minify: true, mangle: true });
	assert(mangled.length <= plain.length, "expected mangled <= plain");
});

section("cli-core — handleInit");

test("handleInit scaffolds project structure in existing directory", () => {
	const dir = mkdtempSync(join(tmpdir(), "gofront-init-cc-"));
	try {
		const result = handleInit(dir);
		const mainPath = join(dir, "app", "src", "main.go");
		const indexPath = join(dir, "app", "index.html");
		const pkgPath = join(dir, "package.json");
		const gitignorePath = join(dir, ".gitignore");
		const devcontainerPath = join(dir, ".devcontainer");

		assert(existsSync(mainPath), "expected app/src/main.go to be created");
		assert(existsSync(indexPath), "expected app/index.html to be created");
		assert(existsSync(pkgPath), "expected package.json to be created");
		assert(existsSync(gitignorePath), "expected .gitignore to be created");
		assert(
			!existsSync(devcontainerPath),
			"expected NO .devcontainer to be created",
		);

		assertEqual(result.mainPath, mainPath);
		assert(
			result.files.includes(mainPath),
			"expected files list to include mainPath",
		);

		const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
		assertEqual(pkg.scripts.dev, "gofront dev");
		assertEqual(pkg.scripts.build, "gofront build");
		assertEqual(pkg.scripts.test, "gofront test");
		assertEqual(pkg.scripts.check, "gofront check");
		assertEqual(Object.keys(pkg.dependencies).length, 0);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("handleInit creates directory if it does not exist", () => {
	const base = mkdtempSync(join(tmpdir(), "gofront-init-new-"));
	const newDir = join(base, "myproject");
	try {
		handleInit(newDir);
		assert(
			existsSync(join(newDir, "app", "src", "main.go")),
			"expected main.go in new dir",
		);
		assert(
			existsSync(join(newDir, "app", "index.html")),
			"expected index.html in new dir",
		);
	} finally {
		rmSync(base, { recursive: true, force: true });
	}
});

test("handleInit throws if main.go or package.json already exists", () => {
	const dir = mkdtempSync(join(tmpdir(), "gofront-init-exists-cc-"));
	writeFileSync(join(dir, "main.go"), "package main\n");
	let threw = false;
	try {
		handleInit(dir);
	} catch (e) {
		threw = true;
		assertContains(e.message, "already exists");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
	assert(threw, "expected throw when main.go already exists");
});

test("handleInit written file contains func main and valid html", () => {
	const dir = mkdtempSync(join(tmpdir(), "gofront-init-content-"));
	try {
		handleInit(dir);
		const content = readFileSync(join(dir, "app", "src", "main.go"), "utf8");
		assertContains(content, "func main()");
		const html = readFileSync(join(dir, "app", "index.html"), "utf8");
		assertContains(html, '<div id="app"></div>');
		assertContains(html, '<script type="module" src="app.js"></script>');
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

section("cli-core — parseTestArgs");

test("parseTestArgs defaults to current dir with no flags", () => {
	const opts = parseTestArgs([]);
	assertEqual(opts.targetDir, ".");
	assertEqual(opts.verbose, false);
	assertEqual(opts.dom, false);
	assertEqual(opts.run, null);
});

test("parseTestArgs picks positional dir and boolean flags", () => {
	const opts = parseTestArgs(["-v", "src", "--dom"]);
	assertEqual(opts.targetDir, "src");
	assertEqual(opts.verbose, true);
	assertEqual(opts.dom, true);
});

test("parseTestArgs accepts all -run spellings", () => {
	assertEqual(parseTestArgs(["-run", "Foo"]).run, "Foo");
	assertEqual(parseTestArgs(["--run", "Foo"]).run, "Foo");
	assertEqual(parseTestArgs(["-run=^Foo$"]).run, "^Foo$");
	assertEqual(parseTestArgs(["--run=a=b"]).run, "a=b");
});

test("parseTestArgs: -run value is not mistaken for the target dir", () => {
	const opts = parseTestArgs(["-run", "Foo", "pkg"]);
	assertEqual(opts.run, "Foo");
	assertEqual(opts.targetDir, "pkg");
});

test("parseTestArgs: trailing -run without value yields null", () => {
	assertEqual(parseTestArgs(["-run"]).run, null);
});

test("parseTestArgs accepts all -bench spellings", () => {
	assertEqual(parseTestArgs(["-bench", "."]).bench, ".");
	assertEqual(parseTestArgs(["--bench", "BenchmarkFoo"]).bench, "BenchmarkFoo");
	assertEqual(parseTestArgs(["-bench=^Benchmark"]).bench, "^Benchmark");
	assertEqual(parseTestArgs(["--bench=a=b"]).bench, "a=b");
	assertEqual(parseTestArgs(["-bench"]).bench, true);
});

section("cli-core — parseLegacyArgs");

test("parseLegacyArgs defaults: no flags", () => {
	const o = parseLegacyArgs(["main.go"]);
	assertEqual(o.inputArg, "main.go");
	assertEqual(o.outputFile, null);
	assertEqual(o.checkOnly, false);
	assertEqual(o.watch, false);
	assertEqual(o.serve, false);
	assertEqual(o.minify, false);
	assertEqual(o.mangle, false);
	assertEqual(o.wasmOpt, false);
	assertEqual(o.sourceMap, false);
	assertEqual(o.copyAssets, false);
	assertEqual(o.port, 3000);
});

test("parseLegacyArgs: -o, --port and boolean flags", () => {
	const o = parseLegacyArgs([
		"src",
		"-o",
		"out.js",
		"--port",
		"8080",
		"--check",
		"--ast",
		"--tokens",
		"--source-map",
		"--copy-assets",
	]);
	assertEqual(o.outputFile, "out.js");
	assertEqual(o.port, 8080);
	assertEqual(o.checkOnly, true);
	assertEqual(o.dumpAst, true);
	assertEqual(o.dumpTokens, true);
	assertEqual(o.sourceMap, true);
	assertEqual(o.copyAssets, true);
});

test("parseLegacyArgs: --release implies --minify --mangle --wasm-opt", () => {
	const o = parseLegacyArgs(["src", "--release"]);
	assertEqual(o.release, true);
	assertEqual(o.minify, true);
	assertEqual(o.mangle, true);
	assertEqual(o.wasmOpt, true);
});

test("parseLegacyArgs: --no-wasm-opt wins over --release / --wasm-opt", () => {
	assertEqual(
		parseLegacyArgs(["src", "--release", "--no-wasm-opt"]).wasmOpt,
		false,
	);
	assertEqual(
		parseLegacyArgs(["src", "--wasm-opt", "--no-wasm-opt"]).wasmOpt,
		false,
	);
	assertEqual(parseLegacyArgs(["src", "--wasm-opt"]).wasmOpt, true);
});

test("parseLegacyArgs: --serve implies --watch", () => {
	const o = parseLegacyArgs(["src", "-o", "out.js", "--serve"]);
	assertEqual(o.serve, true);
	assertEqual(o.watch, true);
	assertEqual(parseLegacyArgs(["src", "--watch"]).serve, false);
	assertEqual(parseLegacyArgs(["src", "--watch"]).watch, true);
});

section("cli-core — parseDevArgs");

test("parseDevArgs: no -o leaves outputFile undefined (project default)", () => {
	// `null` means "do not write a bundle" in handleDev; the absence of the
	// flag must fall through to project.devOutputFile instead.
	const o = parseDevArgs(["app/src", "--port=4000"]);
	assertEqual(o.outputFile, undefined);
	assertEqual("outputFile" in o, true);
	assertEqual(o.targetDir, "app/src");
	assertEqual(o.port, 4000);
	assertEqual(parseDevArgs(["-o", "out/app.js"]).outputFile, "out/app.js");
	assertEqual(parseDevArgs(["--output", "x.js"]).outputFile, "x.js");
});

section("cli-core — assetExtensions");

test("resolveAssetExtensions returns defaults when config has none", () => {
	const exts = resolveAssetExtensions({});
	assert(exts.has(".css"), "expected default .css");
	assert(exts.has(".webp"), "expected default .webp");
	assert(!exts.has(".bmesh"), "did not expect .bmesh by default");
});

test("resolveAssetExtensions merges, normalizes and ignores junk entries", () => {
	const exts = resolveAssetExtensions({
		assetExtensions: [".bmesh", "MAT", " .arena ", "", 42, null],
	});
	assert(exts.has(".css"), "defaults must be preserved");
	assert(exts.has(".bmesh"), "expected .bmesh");
	assert(exts.has(".mat"), "expected dot-prefixed lowercased .mat");
	assert(exts.has(".arena"), "expected trimmed .arena");
	assertEqual(exts.has(""), false);
});

test("handleBuild copies custom assetExtensions from the serve dir", async () => {
	const dir = mkdtempSync(join(tmpdir(), "gofront-assetext-"));
	const outDir = join(dir, "public");
	try {
		writeFileSync(
			join(dir, "package.json"),
			JSON.stringify({ gofront: { assetExtensions: [".bmesh", "mat"] } }),
		);
		mkdirSync(join(dir, "app", "src"), { recursive: true });
		mkdirSync(join(dir, "app", "resources"), { recursive: true });
		writeFileSync(join(dir, "app", "index.html"), "<html></html>");
		writeFileSync(
			join(dir, "app", "src", "main.go"),
			`package main\nfunc main() { console.log("ok") }\n`,
		);
		writeFileSync(join(dir, "app", "resources", "level.bmesh"), "bin");
		writeFileSync(join(dir, "app", "resources", "level.mat"), "mat");
		writeFileSync(join(dir, "app", "resources", "tex.webp"), "img");
		writeFileSync(join(dir, "app", "resources", "notes.unknown"), "x");

		await handleBuild(dir, { outDir });

		assert(existsSync(join(outDir, "resources", "level.bmesh")));
		assert(existsSync(join(outDir, "resources", "level.mat")));
		assert(existsSync(join(outDir, "resources", "tex.webp")));
		assertEqual(existsSync(join(outDir, "resources", "notes.unknown")), false);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

section("cli-core — hybrid (js + wasm) project build");

const HYBRID_FILES = {
	"app/index.html": "<html></html>",
	"app/src/main.go": `package main

import "./physics"

func main() {
	b := physics.NewBody(1.5)
	physics.Kick(b, 2)
	console.log("speed", b.Vel, "mass", b.Mass)
}
`,
	"app/src/physics/physics.go": `//gofront:target wasm
package physics

type Body struct {
	Vel  float64
	Mass float64
}

func NewBody(mass float64) *Body { return &Body{Mass: mass} }

func Kick(b *Body, dv float64) { b.Vel += dv }
`,
};

function writeHybrid(dir) {
	for (const [rel, src] of Object.entries(HYBRID_FILES)) {
		mkdirSync(join(dir, rel, ".."), { recursive: true });
		writeFileSync(join(dir, rel), src);
	}
}

test("handleBuild writes app.js + app.wasm for a hybrid project (no .wat by default)", async () => {
	const dir = mkdtempSync(join(tmpdir(), "gofront-hybrid-build-"));
	const outDir = join(dir, "public");
	try {
		writeHybrid(dir);
		await handleBuild(dir, { outDir });
		assert(existsSync(join(outDir, "app.js")), "expected app.js");
		assert(existsSync(join(outDir, "app.wasm")), "expected app.wasm");
		assertEqual(existsSync(join(outDir, "app.wat")), false);
		const wasm = readFileSync(join(outDir, "app.wasm"));
		assertEqual(Array.from(wasm.subarray(0, 4)).join(","), "0,97,115,109");
		const js = readFileSync(join(outDir, "app.js"), "utf8");
		assertContains(js, "__gfw_load(");
		assertContains(js, "class Body");
		assert(!js.includes("__GOFRONT_WASM_UNIT"), "marker must be spliced out");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("handleBuild --emit-wat also writes app.wat; minified bundle still runs", async () => {
	const dir = mkdtempSync(join(tmpdir(), "gofront-hybrid-wat-"));
	const outDir = join(dir, "public");
	try {
		writeHybrid(dir);
		await handleBuild(dir, { outDir, emitWat: true, minify: true });
		const wat = readFileSync(join(outDir, "app.wat"), "utf8");
		assertContains(wat, "(module");
		assertContains(wat, '(export "Kick"');

		// Run the built bundle with the wasm bytes preloaded (no fetch in Node).
		const js = readFileSync(join(outDir, "app.js"), "utf8");
		const wasm = readFileSync(join(outDir, "app.wasm"));
		const lines = [];
		const runner = join(dir, "run.mjs");
		writeFileSync(
			runner,
			`globalThis.__GOFRONT_WASM_BYTES = new Uint8Array(${JSON.stringify(Array.from(wasm))});
const __out = [];
const console = { log: (...a) => __out.push(a.join(" ")) };
${js}
export const __lines = __out;
`,
		);
		const mod = await import(`${pathToFileURL(runner).href}?t=${Date.now()}`);
		lines.push(...mod.__lines);
		assertEqual(lines[0], "speed 2 mass 1.5");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("writeCompileOutput removes only GoFront-produced stale wasm artifacts", async () => {
	const dir = mkdtempSync(join(tmpdir(), "gofront-stale-wasm-"));
	const outDir = join(dir, "public");
	const out = join(outDir, "app.js");
	try {
		// 1. A hybrid build produces app.wasm + app.wat ...
		writeHybrid(dir);
		await handleBuild(dir, { outDir, emitWat: true });
		assert(existsSync(join(outDir, "app.wasm")));
		assert(existsSync(join(outDir, "app.wat")));
		// ... and a JS-only rebuild cleans both up.
		writeCompileOutput(out, { js: "// js only" });
		assertEqual(existsSync(join(outDir, "app.wasm")), false);
		assertEqual(existsSync(join(outDir, "app.wat")), false);

		// 2. A foreign app.wasm (valid header, no gofront section) is left alone,
		//    together with its .wat.
		writeFileSync(
			join(outDir, "app.wasm"),
			new Uint8Array([0, 0x61, 0x73, 0x6d, 1, 0, 0, 0]),
		);
		writeFileSync(join(outDir, "app.wat"), "(module)");
		writeCompileOutput(out, { js: "// js only" });
		assert(existsSync(join(outDir, "app.wasm")), "foreign app.wasm kept");
		assert(existsSync(join(outDir, "app.wat")), "foreign app.wat kept");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

section("cli-core — target overrides (--js-only, gofront.json targets)");

test("parseTargetFlag / parseBuildArgs recognise --js-only and --target js", () => {
	assertEqual(parseTargetFlag(["--js-only"]), "js");
	assertEqual(parseTargetFlag(["--target", "js"]), "js");
	assertEqual(parseTargetFlag(["--target=js"]), "js");
	assertEqual(parseTargetFlag(["app"]), null);
	let threw = false;
	try {
		parseTargetFlag(["--target", "wasm"]);
	} catch (e) {
		threw = true;
		assertContains(e.message, "unsupported --target 'wasm'");
	}
	assert(threw, "expected --target wasm to be rejected");

	const build = parseBuildArgs(["myapp", "--target", "js"]);
	assertEqual(build.targetDir, "myapp");
	assertEqual(build.forceTarget, "js");
	assertEqual(parseBuildArgs(["--js-only"]).forceTarget, "js");
	assertEqual(parseBuildArgs([]).forceTarget, null);
	assertEqual(parseLegacyArgs(["src", "--js-only"]).forceTarget, "js");
});

test("parseCheckArgs / parseTestArgs: --target value is not a positional", () => {
	const check = parseCheckArgs(["--target", "js", "src"]);
	assertEqual(check.targetDir, "src");
	assertEqual(check.forceTarget, "js");
	assertEqual(parseCheckArgs(["--js-only"]).targetDir, ".");
	const t = parseTestArgs(["--target", "js", "pkg", "-v"]);
	assertEqual(t.targetDir, "pkg");
	assertEqual(t.forceTarget, "js");
	assertEqual(t.verbose, true);
	assertEqual(parseTestArgs(["pkg"]).forceTarget, null);
});

test("check (plain and dir/...) and test honour gofront.json targets", async () => {
	const dir = mkdtempSync(join(tmpdir(), "gofront-targets-check-"));
	try {
		writeHybrid(dir);
		// An invalid override only surfaces if the override is actually applied
		// to the sub-package, with keys resolved against the project src root.
		writeFileSync(
			join(dir, "gofront.json"),
			JSON.stringify({ targets: { physics: "native" } }),
		);
		const expectInvalid = async (fn) => {
			let threw = false;
			try {
				await fn();
			} catch (e) {
				threw = true;
				assertContains(e.message, "invalid target 'native'");
			}
			assert(threw, "expected invalid target error");
		};
		await expectInvalid(() => handleCheck(dir));
		await expectInvalid(() => handleCheck(`${dir}/...`));
		// --js-only wins over the config.
		handleCheck(dir, { forceTarget: "js" });
		// test: the build failure is reported per package rather than thrown.
		writeFileSync(
			join(dir, "app/src/physics/physics_test.go"),
			`package physics

import "testing"

func TestKick(t *testing.T) {
	b := NewBody(1)
	Kick(b, 2)
	if b.Vel != 2 {
		t.Errorf("got %v", b.Vel)
	}
}
`,
		);
		const res = await handleTest(`${dir}/...`, { captureOutput: true });
		assertContains(res.stderr, "invalid target 'native'");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("handleBuild --js-only compiles a hybrid project to JS only", async () => {
	const dir = mkdtempSync(join(tmpdir(), "gofront-js-only-"));
	const outDir = join(dir, "public");
	try {
		writeHybrid(dir);
		await handleBuild(dir, { outDir, forceTarget: "js" });
		assert(existsSync(join(outDir, "app.js")), "expected app.js");
		assertEqual(existsSync(join(outDir, "app.wasm")), false);
		const js = readFileSync(join(outDir, "app.js"), "utf8");
		assert(!js.includes("__gfw_load("), "no wasm loader in a JS-only build");
		assertContains(js, "function Kick");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("gofront.json targets override the //gofront:target directive", async () => {
	const dir = mkdtempSync(join(tmpdir(), "gofront-targets-cfg-"));
	const outDir = join(dir, "public");
	try {
		writeHybrid(dir);
		// The physics package declares wasm; the config forces it back to js.
		writeFileSync(
			join(dir, "gofront.json"),
			JSON.stringify({ targets: { physics: "js" } }),
		);
		await handleBuild(dir, { outDir });
		assertEqual(existsSync(join(outDir, "app.wasm")), false);

		// And the other way round: a plain package promoted to wasm by config.
		writeFileSync(
			join(dir, "app/src/physics/physics.go"),
			HYBRID_FILES["app/src/physics/physics.go"].replace(
				"//gofront:target wasm\n",
				"",
			),
		);
		writeFileSync(
			join(dir, "gofront.json"),
			JSON.stringify({ targets: { physics: "wasm" } }),
		);
		await handleBuild(dir, { outDir });
		assert(
			existsSync(join(outDir, "app.wasm")),
			"config promoted physics to wasm",
		);

		// Invalid values are reported.
		writeFileSync(
			join(dir, "gofront.json"),
			JSON.stringify({ targets: { physics: "native" } }),
		);
		let threw = false;
		try {
			await handleBuild(dir, { outDir });
		} catch (e) {
			threw = true;
			assertContains(
				e.message,
				"invalid target 'native' for package 'physics'",
			);
		}
		assert(threw, "expected invalid target error");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

section("cli-core — parsePrepArgs & formatPrepSummary");

test("parsePrepArgs defaults to '.' and empty vendorConfig", () => {
	const opts = parsePrepArgs([]);
	assertEqual(opts.targetDir, ".");
	assertEqual(Object.keys(opts.vendorConfig).length, 0);
});

test("parsePrepArgs picks dir and --minify regardless of order", () => {
	const a = parsePrepArgs(["--minify", "site"]);
	assertEqual(a.targetDir, "site");
	assertEqual(a.vendorConfig.minify, true);
	const b = parsePrepArgs(["site", "--minify"]);
	assertEqual(b.targetDir, "site");
	assertEqual(b.vendorConfig.minify, true);
});

test("parsePrepArgs ignores single-dash flags like parseTestArgs", () => {
	assertEqual(parsePrepArgs(["-x", "site"]).targetDir, "site");
	assertEqual(parsePrepArgs(["-v"]).targetDir, ".");
});

test("formatPrepSummary returns nothing when nothing happened", () => {
	const lines = formatPrepSummary({
		assets: { copied: 0, skipped: 0 },
		vendor: { bundled: [] },
	});
	assertEqual(lines.length, 0);
});

test("formatPrepSummary reports assets and vendor with array dest + minify", () => {
	const lines = formatPrepSummary({
		assets: { copied: 3, skipped: 1 },
		vendor: {
			bundled: ["marked", "fuse.js"],
			dest: ["app/vendor.js", "public/vendor.js"],
			minify: true,
		},
	});
	assertEqual(lines.length, 2);
	assertEqual(lines[0], "copied 3 assets (1 skipped)");
	assertEqual(
		lines[1],
		"bundled 2 vendor dependencies → app/vendor.js, public/vendor.js (minified)",
	);
});

test("formatPrepSummary reports vendor-only with string dest", () => {
	const lines = formatPrepSummary({
		assets: { copied: 0, skipped: 0 },
		vendor: { bundled: ["marked"], dest: "vendor.js", minify: false },
	});
	assertEqual(lines.length, 1);
	assertEqual(lines[0], "bundled 1 vendor dependencies → vendor.js");
});

section("cli-core — parse cache");

test("clearParseCache resets the cache to zero entries", () => {
	withTempDir({ "main.go": "package main\nfunc main() {}\n" }, (dir) => {
		compileDirCached(dir);
		clearParseCache();
		assert(parseCacheSize() === 0, "expected cache size 0 after clear");
	});
});

test("compileDir populates the parse cache", () => {
	clearParseCache();
	withTempDir({ "main.go": "package main\nfunc main() {}\n" }, (dir) => {
		compileDirCached(dir);
		assert(
			parseCacheSize() > 0,
			"expected cache to be populated after compile",
		);
	});
});

test("second compileDir call reuses cache for unchanged files", () => {
	clearParseCache();
	withTempDir({ "main.go": "package main\nfunc main() {}\n" }, (dir) => {
		compileDirCached(dir);
		const sizeAfterFirst = parseCacheSize();
		compileDirCached(dir);
		assert(
			parseCacheSize() === sizeAfterFirst,
			"cache size should not grow on second compile of unchanged files",
		);
	});
});

section("cli-core — handleCheck");

test("handleCheck returns elapsedMs on valid project directory", () => {
	withTempDir(
		{ "main.go": 'package main\nfunc main() { console.log("check ok") }\n' },
		(dir) => {
			const res = handleCheck(dir);
			assert(res && res.elapsedMs !== undefined, "expected elapsedMs");
		},
	);
});

test("handleCheck throws on type error", () => {
	withTempDir(
		{ "main.go": "package main\nfunc main() { notFoundVar }\n" },
		(dir) => {
			assertThrows(() => handleCheck(dir), "notFoundVar");
		},
	);
});

test("handleCheck on multi-file package compiles all files", () => {
	withTempDir(
		{
			"a.go": "package main\nvar Number = 42\n",
			"main.go": "package main\nfunc main() { console.log(Number) }\n",
		},
		(dir) => {
			const res = handleCheck(dir);
			assert(res && res.elapsedMs !== undefined);
		},
	);
});

section("cli-core — runCompile & writeCompileOutput additional cases");

test("single file with local package import bundles dependency", () => {
	const res = runCompile(
		join(FIXTURES, "multifile/withimport/main.go"),
		false,
		{},
	);
	assert(typeof res.js === "string");
	assertContains(res.js, "function Add(");
	assertContains(res.js, "function Square(");
});

test("single file with npm import emits import statement", () => {
	withTempDir(
		{
			"main.go":
				'package main\nimport "fake-lib"\nfunc main() { r := math.add(1.0, 2.0); console.log(r) }\n',
		},
		(dir) => {
			symlinkSync(
				join(FIXTURES, "node_modules"),
				join(dir, "node_modules"),
				"junction",
			);
			const res = runCompile(join(dir, "main.go"), false, {});
			assertContains(res.js, "from 'fake-lib'");
		},
	);
});

test("single file with unreadable js: import path throws", () => {
	withTempDir(
		{
			"bad_dts.go":
				'package main\nimport "js:nonexistent.d.ts"\nfunc main() {}\n',
		},
		(dir) => {
			assertThrows(() => runCompile(join(dir, "bad_dts.go"), false, {}));
		},
	);
});

test("writeCompileOutput throws on write failure", () => {
	withTempDir((dir) => {
		chmodSync(dir, 0o555);
		try {
			assertThrows(() =>
				writeCompileOutput(
					join(dir, "out.js"),
					{ js: "console.log(1);" },
					"console.log(1);",
				),
			);
		} finally {
			try {
				chmodSync(dir, 0o755);
			} catch {}
		}
	});
});

test("handleDev runs initial dev build and returns controller", async () => {
	await withTempDir(
		{
			"src/main.go": 'package main\nfunc main() { console.log("dev test") }\n',
			"public/index.html": "<html><body></body></html>",
		},
		async (dir) => {
			const dev = await handleDev(dir, {
				serve: false,
				watch: false,
				copyAssets: false,
			});
			assert(dev.written, "must have written info");
			assertEqual(dev.initialError, null);
			await dev.close();
		},
	);
});

test("handleDev with watch and serve starts watchers and closes cleanly", async () => {
	await withTempDir(
		{
			"src/main.go": 'package main\nfunc main() { console.log("dev test") }\n',
			"public/index.html": "<html><body></body></html>",
		},
		async (dir) => {
			const dev = await handleDev(dir, {
				serve: true,
				watch: true,
				port: 3912,
				silent: true,
				copyAssets: false,
			});
			assert(dev.devServer, "must create devServer");
			await dev.close();
		},
	);
});

section("cli-core — colors and diagnostics formatting");

test("formatDiagnostic colorizes labels, gutters, carets, warnings and no-color mode", () => {
	const c = createColors(true);
	const diag = formatDiagnostic(
		"Type error in foo.go:1:2: invalid token\n 1 | x := 1\n   ^\nwarning: unused var\nplain text",
		c,
	);
	assertContains(diag, "Type error");
	assertContains(diag, "\x1b[");

	const uncolored = formatDiagnostic(
		"Type error in foo.go:1:2: invalid token\n 1 | x := 1",
		createColors(false),
	);
	assertEqual(
		uncolored,
		"Type error in foo.go:1:2: invalid token\n 1 | x := 1",
	);
});

test("colorEnabled, logging, and time stamp helpers", () => {
	assert(typeof colorEnabled({ isTTY: false }) === "boolean");
	assert(typeof colorEnabled({ isTTY: true }) === "boolean");
	assert(typeof stamp() === "string");
	assert(typeof ms(25) === "string");

	// Exercise logger methods (silencing or letting stderr print)
	log.info("info msg");
	log.ok("ok msg");
	log.warn("warn msg");
	log.error("error msg");
	log.fail("plain error");
	log.fail("Parse error in test: syntax error\n 1 | syntax\n   ^");

	assertContains(formatWrittenDesc(["dist/app.js"]), "dist/app.js");
	assertContains(
		formatWrittenDesc(["dist/app.js", "dist/app.wasm", "dist/app.wat"]),
		"app.wasm",
	);

	const summaryWithPwa = formatBuildSummary({
		outDir: "public",
		elapsedMs: "10",
		files: [{ name: "app.js", size: 100 }],
		pwa: { assetsCount: 3, version: "v1.0" },
	});
	assert(summaryWithPwa.some((l) => l.includes("pwa: generated sw.js")));
});

test("handleCheck and parseBuildArgs error and edge conditions", () => {
	assertThrows(
		() => handleCheck("/nonexistent/directory/here"),
		/cannot access/,
	);
	assertThrows(() => handleCheck("nonexistent-dir/..."), /No .go files found/);

	const parsed = parseBuildArgs(["--out-dir=custom-dist"]);
	assertEqual(parsed.outDir, "custom-dist");

	const parsedDev = parseDevArgs(["--target", "js", "--port=8080"]);
	assertEqual(parsedDev.port, 8080);
	assertEqual(parsedDev.forceTarget, "js");
});

test("handleTest recursive error condition", async () => {
	await assertRejects(
		() => handleTest("nonexistent-dir/..."),
		/No .go files found/,
	);
});

test("handleTest auto-detects srcDir in project root", async () => {
	await withTempDir(
		{
			"package.json": JSON.stringify({ gofront: { src: "src" } }),
			"src/util.go": "package main\nfunc Add(a, b int) int { return a + b }\n",
			"src/util_test.go":
				'package main\nimport "testing"\nfunc TestAdd(t *testing.T) {\n\tif Add(1, 2) != 3 { t.Fatal("fail") }\n}\n',
		},
		async (dir) => {
			const res = await handleTest(dir, { captureOutput: true });
			assertEqual(res.exitCode, 0);
			assertContains(res.stdout, "PASS");
		},
	);
});

test("handleTest on file target runs tests in containing package directory", async () => {
	await withTempDir(
		{
			"main.go": "package main\nfunc main() {}\n",
			"main_test.go":
				'package main\nimport "testing"\nfunc TestFileTarget(t *testing.T) {}\n',
		},
		async (dir) => {
			const res = await handleTest(join(dir, "main.go"), {
				captureOutput: true,
			});
			assertEqual(res.exitCode, 0);
			assertContains(res.stdout, "PASS");
		},
	);
});

test("handleTest with file config.src resolves cleanly to package directory", async () => {
	await withTempDir(
		{
			"package.json": JSON.stringify({ gofront: { src: "src/main.go" } }),
			"src/main.go": "package main\nfunc main() {}\n",
			"src/main_test.go":
				'package main\nimport "testing"\nfunc TestConfigSrcFile(t *testing.T) {}\n',
		},
		async (dir) => {
			const res = await handleTest(dir, { captureOutput: true });
			assertEqual(res.exitCode, 0);
			assertContains(res.stdout, "PASS");
		},
	);
});

test("handleDev handles initial error and calls onError", async () => {
	await withTempDir(
		{ "main.go": "package main\ninvalid syntax here @@@\n" },
		async (dir) => {
			let errorReported = null;
			const dev = await handleDev(dir, {
				serve: false,
				watch: false,
				onError: (e) => {
					errorReported = e;
				},
			});
			assert(dev.initialError !== null, "expected initialError");
			assert(errorReported !== null, "expected onError callback invocation");
			await dev.close();
		},
	);
});

test("handleInit failure when target directory cannot be created", () => {
	assertThrows(() => handleInit("/sys/forbidden-dir"), /cannot create/);
});

test("handleBuild warns when bundleVendor throws", async () => {
	await withTempDir(
		{ "main.go": "package main\nfunc main() {}\n" },
		async (dir) => {
			const res = await handleBuild(dir, {
				outDir: join(dir, "dist"),
				vendorConfig: {
					packages: ["nonexistent-package-name-xyz"],
				},
			});
			assert(res, "build completed");
		},
	);
});

// ── runSingleShot ─────────────────────────────────────────────

// Run fn while capturing console.log (stdout) and console.error (stderr).
function captureConsole(fn) {
	const out = [];
	const err = [];
	const origLog = console.log;
	const origError = console.error;
	console.log = (...a) => out.push(a.join(" "));
	console.error = (...a) => err.push(a.join(" "));
	try {
		return { code: fn(), out: out.join("\n"), err: err.join("\n") };
	} finally {
		console.log = origLog;
		console.error = origError;
	}
}

const singleShotFlags = (inputArg, extra = {}) => ({
	inputArg,
	...parseLegacyArgs([inputArg]),
	...extra,
});

section("cli-core — runSingleShot");

test("runSingleShot --check returns 0 and prints an OK line", () => {
	withTempDir(
		{ "main.go": 'package main\nfunc main() { console.log("hi") }\n' },
		(dir) => {
			const file = join(dir, "main.go");
			const res = captureConsole(() =>
				runSingleShot(file, false, singleShotFlags(file, { checkOnly: true })),
			);
			assertEqual(res.code, 0);
			assertContains(res.err, "OK");
			assertEqual(res.out, "");
		},
	);
});

test("runSingleShot -o writes the same JS that compileDir produces", () => {
	withTempDir(
		{ "main.go": 'package main\nfunc main() { console.log("hi") }\n' },
		(dir) => {
			const outFile = join(dir, "out", "app.js");
			const res = captureConsole(() =>
				runSingleShot(dir, true, singleShotFlags(dir, { outputFile: outFile })),
			);
			assertEqual(res.code, 0);
			assertContains(res.err, "wrote");
			const expected = compileDirCached(dir, {
				outputDir: join(dir, "out"),
			}).js;
			assertEqual(readFileSync(outFile, "utf8").trimEnd(), expected.trimEnd());
		},
	);
});

test("runSingleShot prints the JS to stdout without -o", () => {
	withTempDir(
		{ "main.go": 'package main\nfunc main() { console.log("hi") }\n' },
		(dir) => {
			const file = join(dir, "main.go");
			const res = captureConsole(() =>
				runSingleShot(file, false, singleShotFlags(file)),
			);
			assertEqual(res.code, 0);
			assertContains(res.out, "console.log");
		},
	);
});

test("runSingleShot returns 1 and logs the compile error", () => {
	withTempDir({ "main.go": "package main\nfunc main() { x := }\n" }, (dir) => {
		const file = join(dir, "main.go");
		const res = captureConsole(() =>
			runSingleShot(file, false, singleShotFlags(file)),
		);
		assertEqual(res.code, 1);
		assertContains(res.err, "ERROR");
		assertEqual(res.out, "");
	});
});

test("runSingleShot --tokens dumps tokens and returns 0", () => {
	withTempDir({ "main.go": "package main\nfunc main() {}\n" }, (dir) => {
		const file = join(dir, "main.go");
		const res = captureConsole(() =>
			runSingleShot(file, false, singleShotFlags(file, { dumpTokens: true })),
		);
		assertEqual(res.code, 0);
		assertContains(res.out, "package");
	});
});

test("runSingleShot --ast dumps the AST as JSON and returns 0", () => {
	withTempDir({ "main.go": "package main\nfunc main() {}\n" }, (dir) => {
		const file = join(dir, "main.go");
		const res = captureConsole(() =>
			runSingleShot(file, false, singleShotFlags(file, { dumpAst: true })),
		);
		assertEqual(res.code, 0);
		assertEqual(typeof JSON.parse(res.out), "object");
	});
});

test("runSingleShot --minify prints minified JS and returns 0", () => {
	withTempDir({ "main.go": "package main\nfunc main() {}\n" }, (dir) => {
		const file = join(dir, "main.go");
		const res = captureConsole(() =>
			runSingleShot(file, false, singleShotFlags(file, { minify: true })),
		);
		assertEqual(res.code, 0);
	});
});

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	process.exit((await summarize()) > 0 ? 1 : 0);
}
