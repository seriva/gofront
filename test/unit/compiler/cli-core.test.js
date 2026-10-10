// GoFront test suite — cli-core direct-import tests

import {
	chmodSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
	formatPrepSummary,
	handleBuild,
	handleInit,
	maybeMinify,
	parseLegacyArgs,
	parsePrepArgs,
	parseTestArgs,
	resolveAssetExtensions,
	runCompile,
	writeCompileOutput,
} from "../../../src/cli-core.js";
import {
	assert,
	assertContains,
	assertEqual,
	FIXTURES,
	section,
	summarize,
	test,
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

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	process.exit((await summarize()) > 0 ? 1 : 0);
}
