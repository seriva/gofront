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

// Returns true for local relative paths (start with ./ or ../)
export function isLocalPath(importPath) {
	return importPath.startsWith("./") || importPath.startsWith("../");
}

// Resolve a local relative import path to an absolute directory of .go files.
// Returns the absolute dir path, or null if it doesn't contain any .go files.
export function resolveGwDir(importPath, fromFile) {
	const fromDir = dirname(resolve(fromFile));
	const dir = resolve(fromDir, importPath);
	if (!existsSync(dir)) return null;
	const gwFiles = readdirSync(dir).filter((f) => f.endsWith(".go"));
	return gwFiles.length > 0 ? dir : null;
}

export function resolveImport(importPath, fromFile) {
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
export function resolveAll(imports, fromFile, parseDts) {
	const resolved = new Map();

	for (const imp of imports) {
		for (const { path } of imp.imports) {
			if (path.startsWith("js:")) continue; // handled separately
			if (isLocalPath(path)) continue; // local .go packages — handled by compiler

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
