// Resolves import paths to .d.ts files.
//
// Resolution order for `import "pkg"`:
//   1. Local `js:` prefix  →  relative .d.ts path (already handled in index.js)
//   2. node_modules/pkg/package.json → "types" or "typings" field
//   3. node_modules/pkg/index.d.ts
//   4. node_modules/@types/pkg/index.d.ts
//
// Returns: { dtsPath: string, importPath: string } or null if not found.
//   dtsPath    — absolute path to the .d.ts file to parse
//   importPath — the JS import path to emit in generated code (e.g. "gl-matrix")

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Walk up from startDir looking for a node_modules directory
function findNodeModules(startDir) {
	let dir = resolve(startDir);
	while (true) {
		const candidate = join(dir, "node_modules");
		if (existsSync(candidate)) return candidate;
		const parent = dirname(dir);
		if (parent === dir) return null; // reached filesystem root
		dir = parent;
	}
}

import { parseDeclarationPackage } from "./dts-parser.js";
import { EXCLUDED_STDLIB_PACKAGES } from "./typechecker/stdlib/excluded.js";
import { STDLIB_PACKAGES } from "./typechecker/types.js";

// Returns true for local relative paths (start with ./ or ../)
export function isLocalPath(importPath) {
	return importPath.startsWith("./") || importPath.startsWith("../");
}

export function isBuiltinPackage(importPath) {
	return STDLIB_PACKAGES.has(importPath);
}

// Go-source stdlib: `stdlib/<import path>/*.go`, written in GoFront Go
// and compiled into the caller's target.
const STDLIB_SOURCE_ROOT = fileURLToPath(
	new URL("../stdlib/", import.meta.url),
);
const STDLIB_PATH_RE = /^[a-z0-9]+(\/[a-z0-9]+)*$/;

// Returns the source directory for a Go-source stdlib import path, or null.
// `root` replaces stdlib/ (tests use a temporary tree).
export function resolveStdlibSource(importPath, root = null) {
	if (!STDLIB_PATH_RE.test(importPath)) return null;
	const dir = join(root ?? STDLIB_SOURCE_ROOT, importPath);
	if (!existsSync(dir)) return null;
	return readdirSync(dir).some((f) => f.endsWith(".go")) ? dir : null;
}

// Typed web declaration packages: `gofront/<name>` is the declaration file
// `stdlib/gofront/<name>/<name>.d.ts` (js packages only). A `gofront/` path
// that is neither one of these nor a built-in (`gofront/shared`) is unsupported.
const DECLARATION_PATH_RE = /^gofront\/([a-z0-9]+)$/;

// Whether an import path is in the `gofront/` namespace without being a
// built-in package: a declaration package or an unsupported one.
export function isDeclarationImport(importPath) {
	return importPath.startsWith("gofront/") && !isBuiltinPackage(importPath);
}

// The declaration file of the `gofront/` import `importPath`, or null.
// `root` replaces stdlib/ (tests use a temporary tree).
export function resolveDeclarationFile(importPath, root = null) {
	const name = DECLARATION_PATH_RE.exec(importPath)?.[1];
	if (!name) return null;
	const file = join(
		root ?? STDLIB_SOURCE_ROOT,
		"gofront",
		name,
		`${name}.d.ts`,
	);
	return existsSync(file) ? file : null;
}

// Declaration packages parsed so far, by file: one parse per process while the
// file is unchanged (`{ stamp, pkg }`, the stamp being its mtime and size).
const declarationCache = new Map();
export const declarationStats = { parsed: 0 };

// The parsed declaration package `name` (`gofront/<name>`, see
// `parseDeclarationPackage`), or null when there is none. Parsed on first use.
// `stamps`, when given, is a Map that records the file read and its stamp.
export function loadDeclarationPackage(name, root = null, stamps = null) {
	const file = resolveDeclarationFile(`gofront/${name}`, root);
	if (!file) return null;
	const stamp = declarationStamp(file);
	stamps?.set(file, stamp);
	const cached = declarationCache.get(file);
	if (cached?.stamp === stamp) return cached.pkg;
	const pkg = parseDeclarationPackage(readFileSync(file, "utf8"), name);
	declarationStats.parsed++;
	declarationCache.set(file, { stamp, pkg });
	return pkg;
}

// The state of a declaration file: its modification time and size, or
// `missing`.
function declarationStamp(file) {
	try {
		const st = statSync(file);
		return `${st.mtimeMs}:${st.size}`;
	} catch {
		return "missing";
	}
}

// Whether every declaration file of `stamps` (`[file, stamp]` pairs, as recorded by
// `loadDeclarationPackage`) is still as it was read.
export function declarationsCurrent(stamps) {
	return stamps.every(([file, stamp]) => declarationStamp(file) === stamp);
}

// Resolve a local relative import path to an absolute directory of .go files.
// Returns the absolute dir path, or null if it doesn't contain any .go files.
export function resolveGwDir(importPath, fromFile) {
	const fromDir = dirname(resolve(fromFile));
	const dir = resolve(fromDir, importPath);
	if (!existsSync(dir)) return null;
	const gwFiles = readdirSync(dir).filter(
		(f) => f.endsWith(".go") || f.endsWith(".templ"),
	);
	return gwFiles.length > 0 ? dir : null;
}

function resolveImport(importPath, fromFile) {
	const fromDir = dirname(resolve(fromFile));
	const nodeModules = findNodeModules(fromDir);

	if (!nodeModules) return null;

	const pkgDir = join(nodeModules, importPath);

	// 1. Check package.json "types" / "typings" field
	const pkgJson = join(pkgDir, "package.json");
	if (existsSync(pkgJson)) {
		try {
			const pkg = JSON.parse(readFileSync(pkgJson, "utf8"));
			const typesField = pkg.types || pkg.typings;
			if (typesField) {
				const dtsPath = resolve(pkgDir, typesField);
				if (existsSync(dtsPath)) return { dtsPath, importPath };
			}
		} catch {}
	}

	// 2. node_modules/pkg/index.d.ts
	const indexDts = join(pkgDir, "index.d.ts");
	if (existsSync(indexDts)) return { dtsPath: indexDts, importPath };

	// 3. @types/pkg
	// Normalize scoped packages: @scope/pkg → @types/scope__pkg
	const atTypesName = importPath.startsWith("@")
		? importPath.slice(1).replace(/\//g, "__")
		: importPath;
	const atTypesDts = join(nodeModules, "@types", atTypesName, "index.d.ts");
	if (existsSync(atTypesDts)) return { dtsPath: atTypesDts, importPath };

	return null;
}

// The Go name an untyped npm import binds: its alias, else the last path
// element with characters that cannot be in an identifier replaced by `_`.
// Returns null for blank (`_`) and dot (`.`) imports, which bind no name.
export function untypedImportName(path, alias = null) {
	if (alias === "_" || alias === ".") return null;
	const name =
		alias ??
		path
			.split("/")
			.at(-1)
			.replace(/[^A-Za-z0-9_$]/g, "_");
	return /^[0-9]/.test(name) ? `_${name}` : name;
}

// The imports of `programs` as [program, spec] pairs.
function* importSpecs(programs) {
	for (const p of programs)
		for (const imp of p.imports)
			for (const spec of imp.imports) yield [p, spec];
}

// Binds every import of `programs` that `resolveAll` found no types for (a
// `null` entry) as a JS-dynamic `any` global in its own file on `checker`, and
// tracks it so an unused one is reported.
export function bindUntypedImports(programs, resolved, checker) {
	for (const [p, spec] of importSpecs(programs)) {
		const { path, alias, _line, _col, line, col } = spec;
		const name = alias === "_" ? null : untypedImportName(path, alias);
		if (!name || resolved.get(path) !== null) continue;
		checker.defineUntypedImport(name, p._filename ?? null, {
			node: { _line, _col, line: line ?? _line, col: col ?? _col ?? 1 },
			source: p._source,
		});
	}
}

// The files of declaration package `name` and the packages it references.
function declarationFiles(name, root, out = new Set()) {
	const file = resolveDeclarationFile(`gofront/${name}`, root);
	if (!file || out.has(file)) return out;
	out.add(file);
	for (const required of loadDeclarationPackage(name, root)?.requires ?? [])
		declarationFiles(required, root, out);
	return out;
}

// Binds every `gofront/<name>` declaration import of `programs` in its own file
// on `checker` (see `bindDeclarationPackage`), loading the package on first
// use. Reports an unsupported `gofront/` path, and a declaration package
// imported from a package that is not js-only. Returns the declaration files
// the build read.
export function bindDeclarationImports(programs, checker, target, root = null) {
	// Every file the checker loads, now or lazily while it checks (a browser
	// global such as `document`), is recorded for the cache key.
	checker.declarationStamps ??= new Map();
	checker.setDeclarationLoader((name) =>
		loadDeclarationPackage(name, root, checker.declarationStamps),
	);
	const files = new Set();
	for (const [p, spec] of importSpecs(programs)) {
		const { path, alias, _line, _col, line, col } = spec;
		if (!isDeclarationImport(path)) continue;
		const node = { _line, _col, line: line ?? _line, col: col ?? _col ?? 1 };
		const name = DECLARATION_PATH_RE.exec(path)?.[1];
		const saved = [checker._currentFile, checker._currentSource];
		checker._currentFile = p._filename ?? null;
		checker._currentSource = p._source ?? null;
		const pkg = name && resolveDeclarationFile(path, root) ? name : null;
		if (!pkg) {
			checker.err(`unsupported package '${path}'`, node);
		} else if (target !== "js") {
			checker.recordBlocker("js: import", path);
			checker.err(`'${path}' is only available in js packages`, node);
		} else if (alias === ".") {
			checker.err(`cannot dot-import '${path}'`, node);
		} else if (alias !== "_") {
			for (const f of declarationFiles(pkg, root)) files.add(f);
			const bound = alias ?? pkg;
			checker.bindDeclarationPackage(
				checker.useDeclarationPackage(pkg),
				bound,
				p._filename ?? null,
			);
			checker.trackImport(bound, node, p._filename ?? null, p._source);
		}
		[checker._currentFile, checker._currentSource] = saved;
	}
	return files;
}

// Given an AST's import list, resolve all imports.
// Returns Map<importPath, { dtsPath, importPath, types, values }>
export function resolveAll(imports, fromFile, parseDts, stdlibRoot = null) {
	const resolved = new Map();

	for (const imp of imports) {
		for (const { path } of imp.imports) {
			if (path.startsWith("js:")) continue; // handled separately
			if (isLocalPath(path)) continue; // local .go packages — handled by compiler
			if (EXCLUDED_STDLIB_PACKAGES.has(path)) continue; // the checker reports it
			if (isBuiltinPackage(path)) continue; // built-in stdlib namespaces — always available
			if (isDeclarationImport(path)) continue; // typed web packages — handled by compiler
			if (resolveStdlibSource(path, stdlibRoot)) continue; // Go-source stdlib — handled by compiler

			if (resolved.has(path)) continue;

			const result = resolveImport(path, fromFile);
			if (!result) {
				console.error(
					`gofront: warning: cannot find types for '${path}', treating as any`,
				);
				resolved.set(path, null);
				continue;
			}

			try {
				const source = readFileSync(result.dtsPath, "utf8");
				const { types, values } = parseDts(source);
				resolved.set(path, { ...result, types, values });
			} catch (e) {
				console.error(
					`gofront: warning: failed to parse '${result.dtsPath}': ${e.message}`,
				);
				resolved.set(path, null);
			}
		}
	}

	return resolved;
}
