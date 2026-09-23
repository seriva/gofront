// GoFront test suite — cli-core direct-import tests

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
import {
	formatPrepSummary,
	handleInit,
	maybeMinify,
	parsePrepArgs,
	parseTestArgs,
	runCompile,
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

test("handleInit creates main.go in existing directory", () => {
	const dir = mkdtempSync(join(tmpdir(), "gofront-init-cc-"));
	const mainPath = join(dir, "main.go");
	try {
		const result = handleInit(dir);
		assert(existsSync(mainPath), "expected main.go to be created");
		assert(result.mainPath === mainPath, "expected returned mainPath");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("handleInit creates directory if it does not exist", () => {
	const base = mkdtempSync(join(tmpdir(), "gofront-init-new-"));
	const newDir = join(base, "myproject");
	try {
		handleInit(newDir);
		assert(existsSync(join(newDir, "main.go")), "expected main.go in new dir");
	} finally {
		rmSync(base, { recursive: true, force: true });
	}
});

test("handleInit throws if main.go already exists", () => {
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

test("handleInit written file contains func main", () => {
	const dir = mkdtempSync(join(tmpdir(), "gofront-init-content-"));
	try {
		handleInit(dir);
		const content = readFileSync(join(dir, "main.go"), "utf8");
		assertContains(content, "func main()");
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
