#!/usr/bin/env node
// GoFront compiler CLI
//
// Usage:
//   gofront <file.go>              — compile single file, print JS to stdout
//   gofront <dir>                  — compile all *.go in directory as one package
//   gofront .                      — compile current directory
//   gofront <file.go> -o out.js    — write to file
//   gofront <dir>    -o out.js     — write bundle to file
//   gofront <file.go> --check      — type-check only (no output)
//   gofront <file.go> --watch      — watch and recompile on change
//   gofront <file.go> --ast        — dump AST of first file (debug)
//   gofront <file.go> --tokens     — dump tokens of first file (debug)
//   gofront init [dir]             — scaffold a new GoFront project

import {
	existsSync,
	mkdirSync,
	readFileSync,
	statSync,
	watch,
	writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";

const _require = createRequire(import.meta.url);
const { version } = _require("../package.json");

import { basename, dirname, join, resolve } from "node:path";
import { minify } from "terser";
import { CodeGen } from "./codegen.js";
import { compileDir } from "./compiler.js";
import { parseDts } from "./dts-parser.js";
import { Lexer } from "./lexer.js";
import { Parser } from "./parser.js";
import { isLocalPath, resolveAll, resolveGwDir } from "./resolver.js";
import { TypeChecker } from "./typechecker.js";

// ── Parse CLI args ───────────────────────────────────────────

const args = process.argv.slice(2);
if (args[0] === "--version" || args[0] === "-v") {
	console.log(`gofront ${version}`);
	process.exit(0);
}

if (args.length === 0 || args[0] === "--help" || args[0] === "-h") {
	console.log(
		`
GoFront — a Go-inspired language that compiles to JavaScript

Usage:
  gofront <file.go>              Compile single file and print to stdout
  gofront <dir>  (or gofront .)    Compile all *.go in directory as one bundle
  gofront <input> -o out.js      Compile and write to file
  gofront <input> --check        Type-check only
  gofront <input> --watch        Watch for changes and recompile
  gofront <input> --source-map   Append inline source map to output
  gofront <input> --minify       Minify output with terser
  gofront <file.go> --ast        Dump AST (debug)
  gofront <file.go> --tokens     Dump tokens (debug)
  gofront init [dir]             Scaffold a new GoFront project
  gofront --version              Print version
`.trim(),
	);
	process.exit(0);
}

// ── init subcommand ──────────────────────────────────────────

if (args[0] === "init") {
	const targetArg = args[1] ?? ".";
	const targetDir = resolve(targetArg);

	if (targetArg !== ".") {
		try {
			mkdirSync(targetDir, { recursive: true });
		} catch (e) {
			console.error(`gofront: cannot create '${targetArg}': ${e.message}`);
			process.exit(1);
		}
	}

	const mainPath = join(targetDir, "main.go");
	if (existsSync(mainPath)) {
		console.error(`gofront: ${mainPath} already exists — nothing written`);
		process.exit(1);
	}

	const pkgName =
		targetArg === "." ? basename(resolve(".")) : basename(targetDir);
	// package names must be valid identifiers
	const safePkg = pkgName.replace(/[^a-zA-Z0-9_]/g, "_").replace(/^[0-9]/, "_");

	const template = `package ${safePkg}

func main() {
\tconsole.log("Hello from GoFront!")
}
`;
	try {
		writeFileSync(mainPath, template);
	} catch (e) {
		console.error(`gofront: cannot write '${mainPath}': ${e.message}`);
		process.exit(1);
	}

	console.error(`gofront: created ${mainPath}`);
	console.error(
		`gofront: run  gofront ${targetArg === "." ? "main.go" : `${targetArg}/main.go`}  to compile`,
	);
	process.exit(0);
}

const inputArg = args[0];
const outputFlag = args.indexOf("-o");
const outputFile = outputFlag !== -1 ? args[outputFlag + 1] : null;
const checkOnly = args.includes("--check");
const dumpAst = args.includes("--ast");
const dumpTokens = args.includes("--tokens");
const sourceMap = args.includes("--source-map");
const watchMode = args.includes("--watch");
const minifyOutput = args.includes("--minify");

// ── Determine input mode ─────────────────────────────────────

const inputPath = resolve(inputArg);
let isDir = false;
try {
	isDir = statSync(inputPath).isDirectory();
} catch (e) {
	console.error(`gofront: cannot access '${inputArg}': ${e.message}`);
	process.exit(1);
}

// ── Compile function (used for initial build and re-builds) ──

function runCompile() {
	if (isDir) {
		return compileDir(inputPath);
	}

	// Single-file mode
	let source;
	try {
		source = readFileSync(inputPath, "utf8");
	} catch (e) {
		throw new Error(`cannot read '${inputArg}': ${e.message}`);
	}

	let tokens;
	tokens = new Lexer(source, basename(inputPath)).tokenize();

	if (dumpTokens) {
		for (const tok of tokens) console.log(tok.toString());
		process.exit(0);
	}

	let ast;
	ast = new Parser(tokens, basename(inputPath), source).parse();
	ast._source = source;

	if (dumpAst) {
		console.log(JSON.stringify(ast, null, 2));
		process.exit(0);
	}

	const checker = new TypeChecker();
	const fromDir = dirname(inputPath);
	const jsImports = new Map();

	for (const imp of ast.imports) {
		for (const path of imp.paths) {
			if (!path.startsWith("js:")) continue;
			const dtsPath = join(fromDir, path.slice(3));
			try {
				const { types, values } = parseDts(readFileSync(dtsPath, "utf8"));
				checker.addDefinitions(types, values);
			} catch (e) {
				throw new Error(`cannot read '${dtsPath}': ${e.message}`);
			}
		}
	}

	const resolved = resolveAll(ast.imports, inputPath, parseDts);
	for (const [path, info] of resolved) {
		if (!info) continue;
		checker.addDefinitions(info.types, info.values);
		jsImports.set(path, [...info.values.keys()]);
	}

	const bundledPackages = new Set();
	const preambles = [];

	for (const imp of ast.imports) {
		for (const path of imp.paths) {
			if (!isLocalPath(path)) continue;
			const depDir = resolveGwDir(path, inputPath);
			if (!depDir) {
				console.error(
					`gofront: warning: cannot find local package '${path}' relative to ${fromDir}`,
				);
				continue;
			}
			const dep = compileDir(depDir);
			preambles.push(dep.js);
			bundledPackages.add(dep.pkgName);
			checker.addPackageNamespace(
				dep.pkgName,
				dep.exportedSymbols,
				dep.exportedTypes,
			);
		}
	}

	const errors = checker.check(ast);
	if (errors.length > 0) {
		throw new Error(errors.map((e) => e.message).join("\n"));
	}

	const cg = new CodeGen(checker, jsImports, bundledPackages);
	let js = cg.generate(ast);

	if (sourceMap) {
		const map = cg.getSourceMap(inputArg);
		const b64 = Buffer.from(map).toString("base64");
		js += `\n//# sourceMappingURL=data:application/json;base64,${b64}`;
	}

	const output = preambles.length > 0 ? `${preambles.join("\n")}\n${js}` : js;
	return { js: output, _cg: cg };
}

function _writeOutput(js) {
	if (outputFile) {
		writeFileSync(outputFile, `${js}\n`);
	} else {
		console.log(js);
	}
}

// ── Minify helper ────────────────────────────────────────────

async function maybeMinify(js) {
	if (!minifyOutput) return js;
	const result = await minify(js, {
		module: true,
		compress: true,
		mangle: true,
	});
	return result.code;
}

// ── Single-shot mode ─────────────────────────────────────────

if (!watchMode) {
	let result;
	const startMs = performance.now();
	try {
		result = runCompile();
	} catch (e) {
		console.error(`gofront: ${e.message}`);
		process.exit(1);
	}

	if (checkOnly) {
		const elapsedMs = (performance.now() - startMs).toFixed(0);
		console.error(`gofront: ${inputArg} — OK (${elapsedMs}ms)`);
		process.exit(0);
	}

	let js;
	try {
		js = await maybeMinify(result.js);
	} catch (e) {
		console.error(`gofront: minify failed: ${e.message}`);
		process.exit(1);
	}

	const elapsedMs = (performance.now() - startMs).toFixed(0);

	if (outputFile) {
		try {
			writeFileSync(outputFile, `${js}\n`);
			console.error(`gofront: wrote ${outputFile} (${elapsedMs}ms)`);
		} catch (e) {
			console.error(`gofront: cannot write '${outputFile}': ${e.message}`);
			process.exit(1);
		}
	} else {
		console.log(js);
	}
	process.exit(0);
}

// ── Watch mode ───────────────────────────────────────────────

function timestamp() {
	return new Date().toLocaleTimeString();
}

async function buildOnce(_label) {
	try {
		const startMs = performance.now();
		const result = runCompile();
		const js = await maybeMinify(result.js);
		const elapsedMs = (performance.now() - startMs).toFixed(0);
		if (outputFile) {
			writeFileSync(outputFile, `${js}\n`);
			console.error(
				`[${timestamp()}] gofront: OK — wrote ${outputFile} (${elapsedMs}ms)`,
			);
		} else {
			// Clear screen then print
			process.stdout.write("\x1Bc");
			console.log(js);
			console.error(`[${timestamp()}] gofront: OK (${elapsedMs}ms)`);
		}
	} catch (e) {
		console.error(`[${timestamp()}] gofront: ERROR`);
		for (const line of e.message.split("\n")) console.error(`  ${line}`);
	}
}

// Initial build
buildOnce("initial");

// Determine what to watch
const watchTarget = isDir ? inputPath : dirname(inputPath);

let debounce = null;
watch(watchTarget, { recursive: true }, (_event, filename) => {
	if (filename && !filename.endsWith(".go")) return;
	clearTimeout(debounce);
	debounce = setTimeout(() => buildOnce(filename ?? "change"), 80);
});

console.error(`[${timestamp()}] gofront: watching ${inputArg} ...`);
