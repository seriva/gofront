// GoFront test suite — CLI process smoke tests

import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
	assert,
	assertContains,
	ROOT,
	section,
	summarize,
	test,
	withTempDir,
} from "../helpers.js";

section("CLI process smoke tests");

const CLI = join(ROOT, "src", "index.js");

function cli(args) {
	const r = spawnSync(process.execPath, [CLI, ...args], { encoding: "utf8" });
	return {
		stdout: r.stdout ?? "",
		stderr: r.stderr ?? "",
		code: r.status ?? 1,
	};
}

test("--version prints version", () => {
	const { stdout, code } = cli(["--version"]);
	assert(code === 0, `expected exit 0, got ${code}`);
	assert(stdout.startsWith("gofront "), `unexpected output: ${stdout}`);
});

test("--help exits 0 and prints usage", () => {
	const { stdout, code } = cli(["--help"]);
	assert(code === 0, `expected exit 0, got ${code}`);
	assertContains(stdout, "gofront");
	assertContains(stdout, "Usage");
});

test("compiles single file to stdout", () => {
	withTempDir(
		{ "main.go": 'package main\nfunc main() { console.log("hello smoke") }\n' },
		(dir) => {
			const { stdout, code } = cli([join(dir, "main.go")]);
			assert(code === 0, `expected exit 0, got ${code}`);
			assertContains(stdout, "hello smoke");
		},
	);
});

test("exits with error on non-existent input file", () => {
	const { code, stderr } = cli(["/nonexistent/path/file.go"]);
	assert(code !== 0, "expected non-zero exit");
	assertContains(stderr, "gofront:");
});

test("gofront init initializes project in directory", () => {
	withTempDir((dir) => {
		const { code } = cli(["init", dir]);
		assert(code === 0, "expected exit 0 on init");
	});
});

test("gofront check exits 0 on valid directory", () => {
	withTempDir(
		{ "main.go": 'package main\nfunc main() { console.log("check ok") }\n' },
		(dir) => {
			const { code, stderr } = cli(["check", dir]);
			assert(code === 0, `expected exit 0, got ${code}: ${stderr}`);
		},
	);
});

test("gofront build compiles package to output directory", () => {
	withTempDir(
		{ "main.go": 'package main\nfunc main() { console.log("built") }\n' },
		(dir) => {
			const outDir = join(dir, "dist");
			const { code } = cli(["build", dir, "-o", outDir]);
			assert(code === 0, "expected exit 0 on build");
		},
	);
});

test("gofront single file with -o and --check and debug dumps", () => {
	withTempDir(
		{ "main.go": 'package main\nfunc main() { console.log("flags") }\n' },
		(dir) => {
			const file = join(dir, "main.go");
			const out = join(dir, "out.js");
			const resOut = cli([file, "-o", out]);
			assert(resOut.code === 0, "expected exit 0 on -o");

			const resChk = cli([file, "--check"]);
			assert(resChk.code === 0, "expected exit 0 on --check");

			const resTok = cli([file, "--tokens"]);
			assert(resTok.code === 0, "expected exit 0 on --tokens");

			const resAst = cli([file, "--ast"]);
			assert(resAst.code === 0, "expected exit 0 on --ast");
		},
	);
});

test("gofront test smoke test", () => {
	withTempDir(
		{
			"main.go": "package main\nfunc Add(a, b int) int { return a + b }\n",
			"main_test.go":
				'package main\nimport "testing"\nfunc TestAdd(t *testing.T) { if Add(1, 2) != 3 { t.Fatal("fail") } }\n',
		},
		(dir) => {
			const { code, stdout } = cli(["test", dir]);
			assert(code === 0, "expected exit 0 on test");
			assertContains(stdout, "PASS");
		},
	);
});

test("gofront dev <dir> starts dev server and prints running url", () => {
	withTempDir(
		{
			"src/main.go":
				'package main\nfunc main() { console.log("dev running") }\n',
			"index.html": "<h1>Dev</h1>",
		},
		(dir) => {
			const r = spawnSync(
				process.execPath,
				[CLI, "dev", dir, "--port", "3899"],
				{
					encoding: "utf8",
					timeout: 500,
				},
			);
			assertContains(r.stderr, "dev server running → http://localhost:3899");
		},
	);
});

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	process.exit((await summarize()) > 0 ? 1 : 0);
}
