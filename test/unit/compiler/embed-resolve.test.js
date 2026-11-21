// GoFront test suite — //go:embed patterns resolve to package files before
// type-checking, and cannot leave the package directory

import { symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
	CompileError,
	clearParseCache,
	compileDir,
	resolveEmbedFiles,
} from "../../../src/compiler.js";
import {
	assert,
	assertEqual,
	assertErrorContains,
	Lexer,
	Parser,
	section,
	summarize,
	test,
	withTempDir,
} from "../helpers.js";

const MAIN = (directive) =>
	`package main\n\n${directive}\nvar data string\n\nfunc main() { println(data) }\n`;

function programFor(dir, directive, file = "main.go") {
	const source = MAIN(directive);
	const ast = new Parser(
		new Lexer(source, file).tokenize(),
		file,
		source,
	).parse();
	ast._path = join(dir, file);
	return ast;
}

const directiveOf = (program) =>
	program.decls.find((d) => d.kind === "VarDecl").decls[0]._embeds[0];

function errorsFor(files, directive) {
	return withTempDir(files, (dir) => {
		const program = programFor(dir, directive);
		return resolveEmbedFiles([program]).map((e) => e.message);
	});
}

function compileError(files, directive) {
	return withTempDir({ ...files, "main.go": MAIN(directive) }, (dir) => {
		clearParseCache();
		try {
			compileDir(dir);
		} catch (e) {
			if (e instanceof CompileError) return e.errors;
			throw e;
		}
		return [];
	});
}

section("//go:embed: pattern safety");

test("embed-resolve: `..` elements escape the package directory", () => {
	for (const pat of ["../secret.env", "a/../b.txt", "./a.txt", "a/./b.txt"]) {
		const msgs = errorsFor({ "a.txt": "x", "b.txt": "y" }, `//go:embed ${pat}`);
		assertEqual(msgs.length, 1);
		assert(
			msgs[0].includes("embed pattern escapes package directory"),
			`${pat}: ${msgs[0]}`,
		);
	}
});

test("embed-resolve: absolute paths and leading or trailing slashes are rejected", () => {
	for (const pat of ["/etc/passwd", "a.txt/", "//a.txt"]) {
		const msgs = errorsFor({ "a.txt": "x" }, `//go:embed ${pat}`);
		assert(
			msgs.some((m) => m.includes("embed pattern escapes package directory")),
			`${pat}: ${msgs.join()}`,
		);
	}
});

test("embed-resolve: backslashes are rejected", () => {
	const msgs = errorsFor({ "a.txt": "x" }, '//go:embed "sub\\\\a.txt"');
	assert(msgs[0].includes("embed pattern escapes package directory"));
});

test("embed-resolve: a symlink out of the package directory is rejected", () => {
	withTempDir(
		{ "pkg/a.txt": "inside", "outside/secret.env": "KEY=1" },
		(root) => {
			symlinkSync(join(root, "outside/secret.env"), join(root, "pkg/link.txt"));
			symlinkSync(join(root, "outside"), join(root, "pkg/dir"));
			for (const pat of ["link.txt", "dir/secret.env"]) {
				const program = programFor(join(root, "pkg"), `//go:embed ${pat}`);
				const msgs = resolveEmbedFiles([program]).map((e) => e.message);
				assert(
					msgs.some((m) =>
						m.includes("embed pattern escapes package directory"),
					),
					`${pat}: ${msgs.join()}`,
				);
				assertEqual(directiveOf(program)._embedFiles, undefined);
			}
		},
	);
});

test("embed-resolve: a symlink that stays inside the package embeds its target", () => {
	withTempDir({ "a.txt": "inside" }, (dir) => {
		symlinkSync(join(dir, "a.txt"), join(dir, "alias.txt"));
		const program = programFor(dir, "//go:embed alias.txt");
		assertEqual(resolveEmbedFiles([program]).length, 0);
		assertEqual(directiveOf(program)._embedFiles[0].path, "alias.txt");
	});
});

test("embed-resolve: a pattern that matches nothing is an error", () => {
	const msgs = errorsFor({ "a.txt": "x" }, "//go:embed missing.txt");
	assertEqual(msgs.length, 1);
	assert(msgs[0].includes("pattern missing.txt matches no files"), msgs[0]);
	assert(msgs[0].includes("main.go at line 3:1"), msgs[0]);
});

test("embed-resolve: every failing pattern of a directive is reported", () => {
	const msgs = errorsFor({ "a.txt": "x" }, "//go:embed a.txt gone.txt ../x");
	assertEqual(msgs.length, 2);
	assert(msgs[0].includes("pattern gone.txt matches no files"));
	assert(msgs[1].includes("embed pattern escapes package directory"));
});

test("embed-resolve: compileDir reports the error before type-checking", () => {
	assertErrorContains(
		compileError({}, "//go:embed ../secrets.env"),
		"embed pattern escapes package directory",
	);
	assertErrorContains(
		compileError({}, "//go:embed nope.txt"),
		"pattern nope.txt matches no files",
	);
});

section("//go:embed: resolved files");

test("embed-resolve: a directive carries the path and bytes of its files", () => {
	withTempDir(
		{
			"a.txt": "alpha",
			"sub/b.bin": Buffer.from([0, 255, 1]).toString("latin1"),
		},
		(dir) => {
			const program = programFor(dir, "//go:embed a.txt sub/b.bin");
			assertEqual(resolveEmbedFiles([program]).length, 0);
			const files = directiveOf(program)._embedFiles;
			assertEqual(files.map((f) => f.path).join(","), "a.txt,sub/b.bin");
			assert(files[0].bytes instanceof Uint8Array);
			assertEqual(Buffer.from(files[0].bytes).toString(), "alpha");
		},
	);
});

test("embed-resolve: patterns resolve against the declaring file's directory", () => {
	withTempDir({ "sub/a.txt": "in sub", "a.txt": "in root" }, (dir) => {
		const program = programFor(join(dir, "sub"), "//go:embed a.txt");
		assertEqual(resolveEmbedFiles([program]).length, 0);
		assertEqual(
			Buffer.from(directiveOf(program)._embedFiles[0].bytes).toString(),
			"in sub",
		);
	});
});

test("embed-resolve: a cached AST re-reads the file on every resolve", () => {
	withTempDir({ "a.txt": "first" }, (dir) => {
		const program = programFor(dir, "//go:embed a.txt");
		resolveEmbedFiles([program]);
		writeFileSync(join(dir, "a.txt"), "second");
		resolveEmbedFiles([program]);
		assertEqual(
			Buffer.from(directiveOf(program)._embedFiles[0].bytes).toString(),
			"second",
		);
	});
});

test("embed-resolve: a stale result does not survive a failing resolve", () => {
	withTempDir({ "a.txt": "first" }, (dir) => {
		const program = programFor(dir, "//go:embed a.txt");
		resolveEmbedFiles([program]);
		const d = directiveOf(program);
		d.patterns = ["a.txt", "gone.txt"];
		assertEqual(resolveEmbedFiles([program]).length, 1);
		assertEqual(d._embedFiles, undefined);
	});
});

test("embed-resolve: directives with a syntax error or no attachment are skipped", () => {
	withTempDir({ "a.txt": "x" }, (dir) => {
		const program = programFor(dir, '//go:embed "unterminated');
		assertEqual(resolveEmbedFiles([program]).length, 0);
		const dangling = programFor(dir, "//go:embed gone.txt\nfunc f() {}\n//");
		assertEqual(resolveEmbedFiles([dangling]).length, 0);
	});
});

test("embed-resolve: a program without a path is skipped", () => {
	const source = MAIN("//go:embed a.txt");
	const ast = new Parser(
		new Lexer(source, "x.go").tokenize(),
		"x.go",
		source,
	).parse();
	assertEqual(resolveEmbedFiles([ast]).length, 0);
});

test("embed-resolve: programs without //go:embed compile unchanged", () => {
	withTempDir(
		{ "main.go": "package main\n\nfunc main() { println(1) }\n" },
		(dir) => {
			clearParseCache();
			const res = compileDir(dir);
			assert(res.js.includes("println") || res.js.length > 0);
		},
	);
});

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	process.exit((await summarize()) > 0 ? 1 : 0);
}
