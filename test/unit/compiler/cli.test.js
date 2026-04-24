// GoFront test suite — CLI flags and watch mode

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
import {
	assert,
	assertContains,
	FIXTURES,
	ROOT,
	section,
	summarize,
	test,
} from "../helpers.js";

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
// Parse cache — incremental compilation
// ═════════════════════════════════════════════════════════════

import {
	clearParseCache,
	compileDir as compileDirCached,
	parseCacheSize,
} from "../../../src/compiler.js";

section("Parse cache");

test("clearParseCache resets the cache to zero entries", () => {
	const dir = mkdtempSync(join(tmpdir(), "gofront-cache-"));
	const file = join(dir, "main.go");
	try {
		writeFileSync(file, `package main\nfunc main() {}\n`);
		compileDirCached(dir);
		clearParseCache();
		assert(parseCacheSize() === 0, "expected cache size 0 after clear");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("compileDir populates the parse cache", () => {
	clearParseCache();
	const dir = mkdtempSync(join(tmpdir(), "gofront-cache2-"));
	const file = join(dir, "main.go");
	try {
		writeFileSync(file, `package main\nfunc main() {}\n`);
		compileDirCached(dir);
		assert(
			parseCacheSize() > 0,
			"expected cache to be populated after compile",
		);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("second compileDir call reuses cache for unchanged files", () => {
	clearParseCache();
	const dir = mkdtempSync(join(tmpdir(), "gofront-cache3-"));
	const file = join(dir, "main.go");
	try {
		writeFileSync(file, `package main\nfunc main() {}\n`);
		compileDirCached(dir);
		const sizeAfterFirst = parseCacheSize();
		compileDirCached(dir);
		assert(
			parseCacheSize() === sizeAfterFirst,
			"cache size should not grow on second compile of unchanged files",
		);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

// ═════════════════════════════════════════════════════════════
// Type error — additional cases
// ═════════════════════════════════════════════════════════════

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	process.exit(summarize() > 0 ? 1 : 0);
}
