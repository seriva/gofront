// Architecture layer guard.
//
// Sentrux only supports a linear layer order, and a source file that no layer
// lists is never checked. This script closes both gaps without adding a TOML
// dependency:
//   1. Every src/**/*.js and stdlib/**/*.go file must match a layer glob in
//      .sentrux/rules.toml, and every glob must match at least one file.
//   2. src/backend/js and src/backend/wasm are peers, so neither may import
//      the other (Sentrux cannot express that).
//
// Run: node scripts/check-layers.js   (exit 1 on any finding)

import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, posix, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

// Unlayered files that are allowed, with the reason.
export const ALLOW = {
	"stdlib/math/extra.go":
		"imports the built-in math/bits, which Sentrux resolves by suffix to src/backend/js/stdlib/bits.js (a false layer violation)",
	"stdlib/internal/jsonrt/dec.go":
		"imports the built-in encoding/base64, which Sentrux resolves by suffix to src/backend/js/stdlib/base64.js (a false layer violation)",
	"stdlib/internal/jsonrt/enc.go":
		"imports the built-in encoding/base64, which Sentrux resolves by suffix to src/backend/js/stdlib/base64.js (a false layer violation)",
};

// Cross-backend imports that are allowed by design: [importer, imported].
export const PERMANENT_CROSS = [
	// The boundary emits JS facade code that calls the JS runtime helpers.
	["src/backend/wasm/boundary.js", "src/backend/js/runtime.js"],
];

// Known edges that are scheduled for removal. Delete an entry when the move
// that fixes it lands.
export const PENDING_CROSS = [];

export const ALLOW_CROSS = [...PERMANENT_CROSS, ...PENDING_CROSS];

// ── Layer coverage ───────────────────────────────────────────

export function parseLayerGlobs(tomlText) {
	const globs = [];
	for (const chunk of tomlText.split("[[layers]]").slice(1)) {
		const m = chunk.match(/^\s*paths\s*=\s*\[([^\]]*)\]/m);
		if (!m) continue;
		for (const s of m[1].matchAll(/"([^"]+)"/g)) globs.push(s[1]);
	}
	return globs;
}

// `*` matches one path segment, `**` any depth (including none).
export function globToRegExp(glob) {
	let re = "";
	for (let i = 0; i < glob.length; i++) {
		const c = glob[i];
		if (c === "*") {
			if (glob[i + 1] === "*") {
				re += ".*";
				i++;
			} else {
				re += "[^/]*";
			}
		} else {
			re += c.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
		}
	}
	return new RegExp(`^${re}$`);
}

export function findLayerGaps(tomlText, files, allow = ALLOW) {
	const globs = parseLayerGlobs(tomlText).map((g) => [g, globToRegExp(g)]);
	const used = new Set();
	const unlayered = [];
	for (const file of files) {
		let layered = false;
		for (const [g, re] of globs) {
			if (re.test(file)) {
				used.add(g);
				layered = true;
			}
		}
		if (!layered && !(file in allow)) unlayered.push(file);
	}
	const dead = globs.map(([g]) => g).filter((g) => !used.has(g));
	return { unlayered: unlayered.sort(), dead };
}

// ── Cross-backend imports ────────────────────────────────────

const JS_DIR = "src/backend/js/";
const WASM_DIR = "src/backend/wasm/";
const SPEC_RE =
	/(?:\bfrom\s*|\bimport\s*\(?\s*)["']([^"']+)["']|\bimport\s*\(\s*["']([^"']+)["']/g;

function backendOf(path) {
	if (path.startsWith(JS_DIR)) return "js";
	if (path.startsWith(WASM_DIR)) return "wasm";
	return null;
}

// sources: { "src/backend/js/x.js": "<file text>" }
export function findCrossBackendImports(sources, allow = ALLOW_CROSS) {
	const found = [];
	for (const [from, text] of Object.entries(sources)) {
		const own = backendOf(from);
		if (!own) continue;
		for (const m of text.matchAll(SPEC_RE)) {
			const spec = m[1] ?? m[2];
			if (!spec.startsWith(".")) continue;
			const to = posix.normalize(posix.join(posix.dirname(from), spec));
			const other = backendOf(to);
			if (!other || other === own) continue;
			if (allow.some(([a, b]) => a === from && b === to)) continue;
			found.push({ from, to });
		}
	}
	return found;
}

// ── CLI ──────────────────────────────────────────────────────

function walk(dir, ext, out = []) {
	for (const e of readdirSync(dir, { withFileTypes: true })) {
		const p = join(dir, e.name);
		if (e.isDirectory()) walk(p, ext, out);
		else if (e.name.endsWith(ext)) out.push(p);
	}
	return out;
}

function main() {
	const rel = (p) => relative(ROOT, p).split("\\").join("/");
	const rules = readFileSync(join(ROOT, ".sentrux/rules.toml"), "utf8");
	const files = [
		...walk(join(ROOT, "src"), ".js"),
		...walk(join(ROOT, "stdlib"), ".go"),
	].map(rel);
	const problems = [];

	const gaps = findLayerGaps(rules, files);
	for (const f of gaps.unlayered)
		problems.push(`unlayered file (add it to .sentrux/rules.toml): ${f}`);
	for (const g of gaps.dead)
		problems.push(`dead layer glob (matches no file): ${g}`);

	const sources = Object.fromEntries(
		files
			.filter((f) => backendOf(f))
			.map((f) => [f, readFileSync(join(ROOT, f), "utf8")]),
	);
	for (const x of findCrossBackendImports(sources))
		problems.push(`cross-backend import: ${x.from} -> ${x.to}`);

	if (problems.length > 0) {
		console.error(`check-layers: ${problems.length} problem(s)`);
		for (const p of problems) console.error(`  ${p}`);
		process.exit(1);
	}
	console.log(`check-layers: ${files.length} files OK`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
	main();
