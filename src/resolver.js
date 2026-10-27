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

import { existsSync, readdirSync, readFileSync } from "node:fs";
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
// and compiled into the caller's target.  A directory for a path that is also
// in STDLIB_PACKAGES is an overlay: its declarations extend that namespace.
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
