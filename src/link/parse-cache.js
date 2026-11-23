// Parsed source files, kept across builds.
//
// The cache keeps each file's pristine AST: every build gets its own
// structural copy (`cloneAst` with `cloneSide`, so the parse-time structures
// such as `_embeds` are copied too), and the passes that rewrite ASTs in place
// (type renaming, lowering, code generation) only ever touch the copy.

import { readFileSync, statSync } from "node:fs";
import { basename, resolve } from "node:path";
import { Lexer } from "../lexer/lexer.js";
import { TemplLexer } from "../lexer/templ-lexer.js";
import { cloneAst } from "../lower/walk.js";
import { Parser } from "../parser/index.js";
import { TemplParser } from "../parser/templ.js";

// Map<filePath, { mtime: number, ast: object }>
const _parseCache = new Map();

// The cache is bounded; the least recently used file goes first.
const PARSE_CACHE_LIMIT = 16;

let _freezeParseCache = false;

// Test flag: deep-freezes every AST the parse cache stores from now on (and
// those it already holds), so a pass that writes to a cached baseline throws.
export function freezeParseCache(on) {
	_freezeParseCache = on;
	if (on) for (const { ast } of _parseCache.values()) deepFreeze(ast);
}

function deepFreeze(node) {
	if (!node || typeof node !== "object" || Object.isFrozen(node)) return;
	Object.freeze(node);
	// Non-enumerable properties (templ nodes keep their parsed expressions
	// there) count too.
	for (const k of Object.getOwnPropertyNames(node))
		deepFreeze(Object.getOwnPropertyDescriptor(node, k).value);
}

export function clearParseCache() {
	_parseCache.clear();
}

// Drops one file, e.g. a throwaway source that was deleted after its build.
export function evictParseCache(filePath) {
	_parseCache.delete(resolve(filePath));
}

export function parseCacheSize() {
	return _parseCache.size;
}

// The AST of `filePath` as this build's own copy.
export function parseGoFrontFile(filePath) {
	const key = resolve(filePath);
	const mtime = statSync(filePath).mtimeMs;
	const cached = _parseCache.get(key);
	if (cached && cached.mtime === mtime) {
		_parseCache.delete(key);
		_parseCache.set(key, cached);
		return cloneAst(cached.ast, { cloneSide: true });
	}

	const source = readFileSync(filePath, "utf8");
	const filename = basename(filePath);
	const isTempl = filePath.endsWith(".templ");
	const tokens = isTempl
		? new TemplLexer(source, filename).tokenize()
		: new Lexer(source, filename).tokenize();
	const ast = isTempl
		? new TemplParser(tokens, filename, source).parse()
		: new Parser(tokens, filename, source).parse();
	ast._source = source;
	ast._path = resolve(filePath);
	// compileFiles overwrites `target` with the resolved one; keep the directive.
	ast._declaredTarget = ast.target;
	if (_freezeParseCache) deepFreeze(ast);
	_parseCache.set(key, { mtime, ast });
	if (_parseCache.size > PARSE_CACHE_LIMIT)
		_parseCache.delete(_parseCache.keys().next().value);
	return cloneAst(ast, { cloneSide: true });
}
