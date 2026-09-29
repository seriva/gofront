// GoFront test suite — CLI flags and watch mode

import { spawnSync } from "node:child_process";
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

test("gofront init creates modern project structure", () => {
	const dir = mkdtempSync(join(tmpdir(), "gofront-init-"));
	try {
		const { code, stderr } = cli(["init", dir]);
		assert(code === 0, `expected exit 0: ${stderr}`);
		const mainPath = join(dir, "app", "src", "main.go");
		assert(existsSync(mainPath), "expected app/src/main.go to be created");
		assert(
			existsSync(join(dir, "app", "index.html")),
			"expected app/index.html to be created",
		);
		assert(
			existsSync(join(dir, "package.json")),
			"expected package.json to be created",
		);
		assert(
			existsSync(join(dir, ".gitignore")),
			"expected .gitignore to be created",
		);
		assert(
			!existsSync(join(dir, ".devcontainer")),
			"expected no .devcontainer to be created",
		);
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

test("--source-map and --minify together exits 1 with conflict error", () => {
	const { file, dir } = makeTmp(
		"conflict.go",
		`package main\nfunc main() { console.log("hi") }\n`,
	);
	try {
		const { code, stderr } = cli([file, "--source-map", "--minify"]);
		assert(code !== 0, "expected non-zero exit");
		assertContains(stderr, "cannot be used together");
	} finally {
		try {
			rmSync(dir, { recursive: true, force: true });
		} catch {}
	}
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

test("gofront init exits 1 if package.json already exists", () => {
	const dir = mkdtempSync(join(tmpdir(), "gofront-init-pkg-exists-"));
	const pkgPath = join(dir, "package.json");
	try {
		writeFileSync(pkgPath, "{}\n");
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

test("gofront init <new-dir> creates directory and modern structure", () => {
	const base = mkdtempSync(join(tmpdir(), "gofront-init-parent-"));
	const newDir = join(base, "myproject");
	try {
		const { code, stderr } = cli(["init", newDir]);
		assert(code === 0, `expected exit 0: ${stderr}`);
		assert(
			existsSync(join(newDir, "app", "src", "main.go")),
			"expected main.go in new dir",
		);
		assert(
			existsSync(join(newDir, "package.json")),
			"expected package.json in new dir",
		);
		assertContains(
			readFileSync(join(newDir, "app", "src", "main.go"), "utf8"),
			"func main()",
		);
	} finally {
		try {
			rmSync(base, { recursive: true, force: true });
		} catch {}
	}
});

test("gofront init . creates modern structure in cwd", () => {
	const tmpDir = mkdtempSync(join(tmpdir(), "gofront-init-dot-"));
	try {
		const r = spawnSync(process.execPath, [CLI, "init", "."], {
			encoding: "utf8",
			cwd: tmpDir,
		});
		assert(r.status === 0, `expected exit 0: ${r.stderr}`);
		assert(
			existsSync(join(tmpDir, "app", "src", "main.go")),
			"expected main.go in tmpDir",
		);
		assert(
			existsSync(join(tmpDir, "package.json")),
			"expected package.json in tmpDir",
		);
		assertContains(
			readFileSync(join(tmpDir, "app", "src", "main.go"), "utf8"),
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
// Semantic subcommands — check, build, dev, init
// ═════════════════════════════════════════════════════════════

section("CLI semantic subcommands — check, build, dev");

test("gofront check <dir> exits 0 on valid project", () => {
	const dir = mkdtempSync(join(tmpdir(), "gofront-cli-chk-"));
	try {
		writeFileSync(
			join(dir, "main.go"),
			`package main\nfunc main() { console.log("check ok") }\n`,
		);
		const { code, stderr } = cli(["check", dir]);
		assert(code === 0, `expected exit 0, got ${code}: ${stderr}`);
		assertContains(stderr, "OK");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("gofront check <dir> exits 1 on type error", () => {
	const dir = mkdtempSync(join(tmpdir(), "gofront-cli-chk-err-"));
	try {
		writeFileSync(
			join(dir, "main.go"),
			`package main\nfunc main() { notFoundVar }\n`,
		);
		const { code, stderr } = cli(["check", dir]);
		assert(code !== 0, "expected non-zero exit on type error");
		assertContains(stderr, "notFoundVar");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("gofront build <dir> -o <outDir> compiles release bundle", () => {
	const dir = mkdtempSync(join(tmpdir(), "gofront-cli-bld-"));
	const outDir = join(dir, "release");
	try {
		mkdirSync(join(dir, "app", "src"), { recursive: true });
		writeFileSync(
			join(dir, "app", "index.html"),
			"<html><body>Hello</body></html>",
		);
		writeFileSync(
			join(dir, "app", "src", "main.go"),
			`package main\nfunc main() { console.log("built release") }\n`,
		);

		const { code, stderr } = cli(["build", dir, "-o", outDir]);
		assert(code === 0, `expected exit 0, got ${code}: ${stderr}`);
		assertContains(stderr, "build complete");
		assert(
			existsSync(join(outDir, "app.js")),
			"expected release/app.js to exist",
		);
		assert(
			existsSync(join(outDir, "index.html")),
			"expected release/index.html to exist",
		);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("gofront dev <dir> starts dev server and prints running url", () => {
	const dir = mkdtempSync(join(tmpdir(), "gofront-cli-dev-"));
	try {
		mkdirSync(join(dir, "src"), { recursive: true });
		writeFileSync(join(dir, "index.html"), "<h1>Dev</h1>");
		writeFileSync(
			join(dir, "src", "main.go"),
			`package main\nfunc main() { console.log("dev running") }\n`,
		);

		const r = spawnSync(process.execPath, [CLI, "dev", dir, "--port", "3899"], {
			encoding: "utf8",
			timeout: 800,
		});
		assertContains(r.stderr, "dev server running → http://localhost:3899");
		assertContains(r.stderr, "watching");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("initialized project passes check and build", () => {
	const dir = mkdtempSync(join(tmpdir(), "gofront-cli-init-e2e-"));
	try {
		const initRes = cli(["init", dir]);
		assert(initRes.code === 0, `init failed: ${initRes.stderr}`);

		const chkRes = cli(["check", dir]);
		assert(chkRes.code === 0, `check failed: ${chkRes.stderr}`);
		assertContains(chkRes.stderr, "OK");

		const bldRes = cli(["build", dir]);
		assert(bldRes.code === 0, `build failed: ${bldRes.stderr}`);
		assertContains(bldRes.stderr, "build complete");
		assert(existsSync(join(dir, "public", "app.js")), "expected public/app.js");
		assert(
			existsSync(join(dir, "public", "index.html")),
			"expected public/index.html",
		);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("gofront test auto-detects srcDir in project root", () => {
	const dir = mkdtempSync(join(tmpdir(), "gofront-cli-test-detect-"));
	try {
		mkdirSync(join(dir, "src"), { recursive: true });
		writeFileSync(
			join(dir, "package.json"),
			JSON.stringify({ gofront: { src: "src" } }),
		);
		writeFileSync(
			join(dir, "src", "util.go"),
			`package main\nfunc Add(a, b int) int { return a + b }\n`,
		);
		writeFileSync(
			join(dir, "src", "util_test.go"),
			`package main\nimport "testing"\nfunc TestAdd(t *testing.T) {\n\tif Add(1, 2) != 3 { t.Fatal("fail") }\n}\n`,
		);

		const r = cli(["test", dir]);
		assert(r.code === 0, `test failed: ${r.stderr}`);
		assertContains(r.stdout, "PASS");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("gofront check on multi-file package directory compiles all package files", () => {
	const dir = mkdtempSync(join(tmpdir(), "gofront-cli-check-multi-"));
	try {
		writeFileSync(join(dir, "a.go"), `package main\nvar Number = 42\n`);
		writeFileSync(
			join(dir, "main.go"),
			`package main\nfunc main() {\n\tconsole.log(Number)\n}\n`,
		);

		const r = cli(["check", dir]);
		assert(r.code === 0, `check failed: ${r.stderr}`);
		assertContains(r.stderr, "OK");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("gofront test on file target runs tests in containing package directory", () => {
	const dir = mkdtempSync(join(tmpdir(), "gofront-cli-test-file-"));
	try {
		writeFileSync(join(dir, "main.go"), "package main\nfunc main() {}\n");
		writeFileSync(
			join(dir, "main_test.go"),
			`package main\nimport "testing"\nfunc TestFileTarget(t *testing.T) {}\n`,
		);

		const r = cli(["test", join(dir, "main.go")]);
		assert(r.code === 0, `test failed: ${r.stderr}`);
		assertContains(r.stdout, "PASS");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("gofront test with file config.src resolves cleanly to package directory", () => {
	const dir = mkdtempSync(join(tmpdir(), "gofront-cli-test-cfgfile-"));
	try {
		mkdirSync(join(dir, "src"), { recursive: true });
		writeFileSync(
			join(dir, "package.json"),
			JSON.stringify({ gofront: { src: "src/main.go" } }),
		);
		writeFileSync(
			join(dir, "src", "main.go"),
			"package main\nfunc main() {}\n",
		);
		writeFileSync(
			join(dir, "src", "main_test.go"),
			`package main\nimport "testing"\nfunc TestConfigSrcFile(t *testing.T) {}\n`,
		);

		const r = cli(["test", dir]);
		assert(r.code === 0, `test failed: ${r.stderr}`);
		assertContains(r.stdout, "PASS");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	process.exit((await summarize()) > 0 ? 1 : 0);
}
