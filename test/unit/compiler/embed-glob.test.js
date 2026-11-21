// GoFront test suite — //go:embed glob and directory patterns follow Go's
// rules: path.Match globs, recursive directories without `.` and `_` names,
// the `all:` prefix and sorted results

import { symlinkSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveEmbedFiles } from "../../../src/compiler.js";
import {
	assert,
	assertEqual,
	Lexer,
	Parser,
	section,
	summarize,
	test,
	withTempDir,
} from "../helpers.js";

const MAIN = (directive) =>
	`package main\n\n${directive}\nvar data string\n\nfunc main() { println(data) }\n`;

function programFor(dir, directive) {
	const source = MAIN(directive);
	const ast = new Parser(
		new Lexer(source, "main.go").tokenize(),
		"main.go",
		source,
	).parse();
	ast._path = join(dir, "main.go");
	return ast;
}

// Resolves `directive` in a package holding `files`: the sorted paths it
// embeds, or the error messages.
function resolve(files, directive, setup) {
	return withTempDir(files, (dir) => {
		setup?.(dir);
		const program = programFor(dir, directive);
		const errors = resolveEmbedFiles([program]).map((e) => e.message);
		const spec = program.decls.find((d) => d.kind === "VarDecl").decls[0];
		const paths = spec._embeds[0]._embedFiles?.map((f) => f.path);
		return { errors, paths };
	});
}

const TREE = {
	"top.txt": "t",
	".top": "d",
	"assets/a.txt": "a",
	"assets/.dot": "x",
	"assets/_under": "x",
	"assets/sub/b.txt": "b",
	"assets/sub/.c": "x",
	"assets/.hid/d": "x",
	"assets/_u/e": "x",
	"shaders/l.wgsl": "l",
	"shaders/m.wgsl": "m",
	"shaders/n.txt": "n",
	"shaders/.h.wgsl": "h",
	"x/y/z.txt": "z",
	"x/w/z.txt": "z2",
};

const paths = (directive, files = TREE, setup) => {
	const r = resolve(files, directive, setup);
	assertEqual(r.errors.length, 0, r.errors.join("\n"));
	return r.paths.join(",");
};

section("//go:embed: globs");

test("embed-glob: a glob matches the files of one directory, sorted", () => {
	assertEqual(
		paths("//go:embed shaders/*.wgsl"),
		"shaders/.h.wgsl,shaders/l.wgsl,shaders/m.wgsl",
	);
});

test("embed-glob: * does not cross a slash", () => {
	assertEqual(paths("//go:embed *.txt"), "top.txt");
	assertEqual(paths("//go:embed assets/*.txt"), "assets/a.txt");
	assertEqual(
		paths("//go:embed x/*.txt", { "x/a.txt": "1", "x/y/a.txt": "2" }),
		"x/a.txt",
	);
});

test("embed-glob: ? and character classes match one character", () => {
	const files = { "a1.txt": "1", "a2.txt": "2", "b1.txt": "3", "a10.txt": "4" };
	assertEqual(paths("//go:embed a?.txt", files), "a1.txt,a2.txt");
	assertEqual(paths("//go:embed [ab]1.txt", files), "a1.txt,b1.txt");
	assertEqual(
		paths("//go:embed [a-b][1-2].txt", files),
		"a1.txt,a2.txt,b1.txt",
	);
	assertEqual(paths("//go:embed [^a]1.txt", files), "b1.txt");
});

test("embed-glob: a glob in a directory element", () => {
	assertEqual(paths("//go:embed x/*/z.txt"), "x/w/z.txt,x/y/z.txt");
	assertEqual(paths("//go:embed */y/z.txt"), "x/y/z.txt");
});

test("embed-glob: a glob matches names that start with . or _", () => {
	assertEqual(paths("//go:embed assets/_*", TREE), "assets/_u/e,assets/_under");
	assertEqual(paths("//go:embed .t*"), ".top");
});

test("embed-glob: results are sorted and deduplicated across patterns", () => {
	assertEqual(
		paths("//go:embed shaders/m.wgsl shaders/l.wgsl shaders/*.wgsl top.txt"),
		"shaders/.h.wgsl,shaders/l.wgsl,shaders/m.wgsl,top.txt",
	);
});

test("embed-glob: a file matched by two patterns is one entry", () => {
	assertEqual(paths("//go:embed top.txt t*.txt"), "top.txt");
});

section("//go:embed: directories");

test("embed-glob: a directory embeds its tree without . and _ names", () => {
	assertEqual(paths("//go:embed assets"), "assets/a.txt,assets/sub/b.txt");
});

test("embed-glob: all: keeps . and _ names", () => {
	assertEqual(
		paths("//go:embed all:assets"),
		"assets/.dot,assets/.hid/d,assets/_u/e,assets/_under,assets/a.txt,assets/sub/.c,assets/sub/b.txt",
	);
});

test("embed-glob: a glob that matches a directory embeds that tree", () => {
	// `assets/*` names .hid and _u, so their trees are embedded; inside a tree
	// the exclusion still applies (assets/sub/.c).
	assertEqual(
		paths("//go:embed assets/*"),
		"assets/.dot,assets/.hid/d,assets/_u/e,assets/_under,assets/a.txt,assets/sub/b.txt",
	);
});

test("embed-glob: * at the top embeds everything but dot and underscore names inside directories", () => {
	assertEqual(
		paths("//go:embed *", { "a.txt": "1", ".b": "2", "d/x": "3", "d/_y": "4" }),
		".b,a.txt,d/x",
	);
});

test("embed-glob: a nested directory with a go.mod is another module and is skipped", () => {
	assertEqual(
		paths("//go:embed d", {
			"d/a.txt": "1",
			"d/mod/go.mod": "m",
			"d/mod/b.txt": "2",
		}),
		"d/a.txt",
	);
});

test("embed-glob: a symlink to a file inside a matched directory is irregular", () => {
	const r = resolve({ "d/a.txt": "1" }, "//go:embed d", (dir) =>
		symlinkSync(join(dir, "d/a.txt"), join(dir, "d/link.txt")),
	);
	assertEqual(r.errors.length, 1);
	assert(
		r.errors[0].includes("cannot embed irregular file d/link.txt"),
		r.errors[0],
	);
});

section("//go:embed: pattern errors");

test("embed-glob: a malformed glob is an invalid pattern", () => {
	for (const pat of ["[", "[a", "a[]", "[a-]", "x[^]"]) {
		const r = resolve({ "a.txt": "1" }, `//go:embed "${pat}"`);
		assertEqual(r.errors.length, 1, pat);
		assert(
			r.errors[0].includes(`pattern ${pat}: invalid pattern syntax`),
			`${pat}: ${r.errors[0]}`,
		);
	}
});

test("embed-glob: a glob that matches nothing is an error", () => {
	const r = resolve({ "a.txt": "1" }, "//go:embed *.wgsl");
	assert(r.errors[0].includes("pattern *.wgsl matches no files"), r.errors[0]);
});

test("embed-glob: a directory without embeddable files is an error", () => {
	const r = resolve({ "d/.hidden": "1", "d/_x": "2" }, "//go:embed d");
	assert(
		r.errors[0].includes(
			"cannot embed directory d: contains no embeddable files",
		),
		r.errors[0],
	);
	assertEqual(r.paths, undefined);
});

test("embed-glob: a glob cannot reach a symlink out of the package", () => {
	for (const pat of ["*.txt", "dir/*"]) {
		const r = withTempDir(
			{ "pkg/a.txt": "in", "outside/secret.env": "KEY=1" },
			(root) => {
				symlinkSync(
					join(root, "outside/secret.env"),
					join(root, "pkg/link.txt"),
				);
				symlinkSync(join(root, "outside"), join(root, "pkg/dir"));
				const program = programFor(join(root, "pkg"), `//go:embed ${pat}`);
				return resolveEmbedFiles([program]).map((e) => e.message);
			},
		);
		assert(
			r.some((m) => m.includes("embed pattern escapes package directory")),
			`${pat}: ${r.join()}`,
		);
	}
});

test("embed-glob: a glob cannot climb out through a directory element", () => {
	const r = resolve({ "a.txt": "1" }, "//go:embed ../*");
	assert(r.errors[0].includes("embed pattern escapes package directory"));
});

test("embed-glob: all: needs a pattern and checks it like any other", () => {
	assert(
		resolve({ "a.txt": "1" }, "//go:embed all:../x").errors[0].includes(
			"embed pattern escapes package directory",
		),
	);
	assert(
		resolve({ "a.txt": "1" }, "//go:embed all:").errors[0].includes(
			"embed pattern escapes package directory",
		),
	);
	assertEqual(paths("//go:embed all:a.txt", { "a.txt": "1" }), "a.txt");
});

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	process.exit((await summarize()) > 0 ? 1 : 0);
}
