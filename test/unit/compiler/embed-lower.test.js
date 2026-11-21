// GoFront test suite — `lowerEmbeds` turns //go:embed directives on `string`,
// `[]byte` and `embed.FS` variables into `EmbedData` side-table nodes

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { clearParseCache, resolveEmbedFiles } from "../../../src/compiler.js";
import { lower, lowerEmbeds } from "../../../src/lower/index.js";
import { TypeChecker } from "../../../src/typechecker/index.js";
import {
	assert,
	assertEqual,
	compileDir,
	join,
	Lexer,
	Parser,
	section,
	summarize,
	test,
	withTempDir,
} from "../helpers.js";

const EMBED_IMPORT = 'import _ "embed"';
const SOURCE = (body, imports) =>
	`package main\n\n${imports}\n\n${body}\nfunc main() {}\n`;

// Parses, resolves and type-checks `body` as `main.go` in `dir`.
function prepare(dir, body, imports = EMBED_IMPORT) {
	const source = SOURCE(body, imports);
	const ast = new Parser(
		new Lexer(source, "main.go").tokenize(),
		"main.go",
		source,
	).parse();
	ast._path = join(dir, "main.go");
	const resolveErrors = resolveEmbedFiles([ast]);
	assertEqual(resolveErrors.length, 0);
	const checker = new TypeChecker();
	const errors = checker.check(ast);
	assertEqual(errors.length, 0);
	return { ast, checker };
}

const specs = (ast) =>
	ast.decls.filter((d) => d.kind === "VarDecl").flatMap((d) => d.decls);

const text = (bytes) => new TextDecoder().decode(bytes);

section("lowerEmbeds: scalar directives");

test("embed-lower: a string directive becomes an EmbedData node", () => {
	withTempDir({ "a.txt": "alpha" }, (dir) => {
		const { ast, checker } = prepare(dir, "//go:embed a.txt\nvar s string\n");
		lower([ast], checker);
		const [spec] = specs(ast);
		const data = spec._embedData;
		assertEqual(data.kind, "EmbedData");
		assertEqual(data.as, "string");
		assertEqual(data._files.length, 1);
		assertEqual(data._files[0].path, "a.txt");
		assertEqual(text(data._files[0].bytes), "alpha");
		assertEqual(data._type.name, "string");
	});
});

test("embed-lower: []byte and []uint8 directives are `bytes`", () => {
	withTempDir({ "a.txt": "alpha" }, (dir) => {
		const { ast, checker } = prepare(
			dir,
			"//go:embed a.txt\nvar b []byte\n//go:embed a.txt\nvar u []uint8\n",
		);
		lower([ast], checker);
		for (const spec of specs(ast)) {
			assertEqual(spec._embedData.kind, "EmbedData");
			assertEqual(spec._embedData.as, "bytes");
			assertEqual(spec._embedData._type.kind, "slice");
		}
	});
});

test("embed-lower: aliases and defined types of string or []byte lower too", () => {
	withTempDir({ "a.txt": "alpha" }, (dir) => {
		const { ast, checker } = prepare(
			dir,
			`type S = string
type B = []byte
type Named string
//go:embed a.txt
var s S
//go:embed a.txt
var b B
//go:embed a.txt
var n Named
`,
		);
		lower([ast], checker);
		assertEqual(
			specs(ast)
				.map((s) => s._embedData.as)
				.join(),
			"string,bytes,string",
		);
	});
});

test("embed-lower: spec.value stays null and the spec keeps its directive", () => {
	withTempDir({ "a.txt": "alpha" }, (dir) => {
		const { ast, checker } = prepare(dir, "//go:embed a.txt\nvar s string\n");
		lower([ast], checker);
		const [spec] = specs(ast);
		assert(!spec.value || spec.value.length === 0, "value untouched");
		assertEqual(spec._embeds.length, 1);
	});
});

test("embed-lower: several directives on one var contribute one deduplicated file", () => {
	withTempDir({ "a.txt": "alpha" }, (dir) => {
		const { ast, checker } = prepare(
			dir,
			"//go:embed a.txt\n//go:embed a.txt\nvar b []byte\n",
		);
		lower([ast], checker);
		assertEqual(specs(ast)[0]._embedData._files.length, 1);
	});
});

test("embed-lower: grouped vars lower per spec; plain vars get no node", () => {
	withTempDir({ "a.txt": "alpha", "b.txt": "beta" }, (dir) => {
		const { ast, checker } = prepare(
			dir,
			"var (\n\t//go:embed a.txt\n\ta string\n\t//go:embed b.txt\n\tb []byte\n\tc int\n)\n",
		);
		lower([ast], checker);
		const [a, b, c] = specs(ast);
		assertEqual(text(a._embedData._files[0].bytes), "alpha");
		assertEqual(text(b._embedData._files[0].bytes), "beta");
		assertEqual(c._embedData, undefined);
	});
});

test("embed-lower: lowerEmbeds is idempotent and takes a single program", () => {
	withTempDir({ "a.txt": "alpha" }, (dir) => {
		const { ast } = prepare(dir, "//go:embed a.txt\nvar s string\n");
		lowerEmbeds([ast]);
		const first = specs(ast)[0]._embedData;
		lowerEmbeds([ast]);
		const second = specs(ast)[0]._embedData;
		assertEqual(first.as, second.as);
		assertEqual(second._files.length, 1);
	});
});

section("lowerEmbeds: cached ASTs");

test("embed-lower: recompiling a cached AST does not hit `var with initializer`", () => {
	const files = {
		"a.txt": "alpha",
		"main.go": SOURCE("//go:embed a.txt\nvar s string\n", EMBED_IMPORT),
	};
	withTempDir(files, (dir) => {
		clearParseCache();
		compileDir(dir);
		// The parse cache serves the same AST, lowered once already.
		compileDir(dir);
		compileDir(dir, { forceTarget: "wasm" });
	});
});

test("embed-lower: a changed file is lowered again from a cached AST", () => {
	withTempDir({ "a.txt": "alpha" }, (dir) => {
		const { ast, checker } = prepare(dir, "//go:embed a.txt\nvar s string\n");
		lower([ast], checker);
		assertEqual(text(specs(ast)[0]._embedData._files[0].bytes), "alpha");
		writeFileSync(join(dir, "a.txt"), "omega");
		assertEqual(resolveEmbedFiles([ast]).length, 0);
		lower([ast], checker);
		assertEqual(text(specs(ast)[0]._embedData._files[0].bytes), "omega");
	});
});

section("lowerEmbeds: embed.FS");

test("embed-lower: an embed.FS directive becomes an `fs` node with every file, sorted", () => {
	withTempDir(
		{
			"b.txt": "beta",
			"a.txt": "alpha",
			"sub/c.txt": "c",
			"main.go": SOURCE(
				"//go:embed sub b.txt\n//go:embed a.txt\nvar files embed.FS\n",
				'import "embed"',
			),
		},
		(dir) => {
			clearParseCache();
			const { programs } = compileDir(dir);
			const main = programs.find((p) => p._filename === "main.go");
			const [spec] = specs(main);
			assertEqual(spec.value ?? null, null);
			const data = spec._embedData;
			assertEqual(data.kind, "EmbedData");
			assertEqual(data.as, "fs");
			assertEqual(
				data._files.map((f) => f.path).join(","),
				"a.txt,b.txt,sub/c.txt",
			);
			assertEqual(text(data._files[2].bytes), "c");
			assertEqual(data._type.name, "FS$$embed");
		},
	);
});

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	process.exit((await summarize()) > 0 ? 1 : 0);
}
