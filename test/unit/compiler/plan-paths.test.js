// GoFront test suite — repository paths cited in the design plans
//
// Every backticked `src/…`, `stdlib/…`, `test/…` and `scripts/…` path in a
// plan must exist, except paths the plan creates itself (listed per plan,
// with the reason).  Keeps plans from drifting away from the source tree.

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { assert, assertEqual, section, test, withTempDir } from "../helpers.js";

// Repo root from this file's location, never from the working directory.
const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));

const ROOTS = ["src", "stdlib", "test", "scripts"];

// Plans checked against the real tree, with the paths each one creates itself.
// An exempt entry is a glob (braces allowed) matched against the normalized path; keep each
// list as small as the plan allows and say why.
const PLANS = [
	{
		file: "plans/roadmap.md",
		exempt: [],
	},
	{
		file: "plans/v1.9.0/stdlib-in-go-plan.md",
		exempt: [
			// The Go files each migration task adds under stdlib/.  Files that
			// exist today (for example stdlib/sort/sort.go) are not listed.
			// Files that completed tasks removed (their "Removes" lines still cite them).
			"src/backend/js/stdlib/{slices,sort}.js",
			"stdlib/slices/{extra,iter}.go",
			"src/backend/js/stdlib/maps.js",
			"stdlib/maps/iter.go",
			"stdlib/errors/overlay.go",
			"src/backend/js/stdlib/{html,path}.js",
			"src/backend/js/stdlib/utf8.js",
			"stdlib/unicode/utf8/bytes.go",
			"src/backend/js/stdlib/io.js",
			"stdlib/bytes/{iter,search,split}.go",
			"src/backend/{js,wasm}/stdlib/bytes.js",
			"src/backend/js/stdlib/strings.js",
			"stdlib/strings/{extra,iter}.go",
			"src/backend/js/stdlib/{base64,hex,sha256}.js",
			"src/backend/js/stdlib/{bits,rand,sync}.js",
			"stdlib/sync/extra.go",
			"src/backend/wasm/stdlib/time.js",
			"src/backend/js/stdlib/strconv.js",
		],
	},
];

// ── Path extraction ──────────────────────────────────────────

function expandBraces(s) {
	const m = s.match(/\{([^{}]*)\}/);
	if (!m) return [s];
	return m[1]
		.split(",")
		.flatMap((alt) =>
			expandBraces(s.slice(0, m.index) + alt + s.slice(m.index + m[0].length)),
		);
}

// Normalized path candidates from the inline code spans of a markdown text.
// A span may hold a command (`git mv a b`), so it is split on whitespace.
// Fenced code blocks are skipped: they hold commands and sample output, not
// references.  Handled forms: trailing punctuation, `./` prefix, `:12` or
// `#L12` suffixes, `{a,b}` alternatives and `<name>` placeholders (both
// become wildcards).  Excluded on purpose: tokens that do not start with one
// of ROOTS (`*/stdlib/`, bare `wasm/index.js` shorthand) and `…`/`...`
// elisions, which are not paths.
export function extractPlanPaths(markdown) {
	const prose = markdown.replace(/^(```|~~~)[^\n]*\n[\s\S]*?^\1[^\n]*$/gm, "");
	const out = new Set();
	for (const span of prose.matchAll(/`([^`\n]+)`/g)) {
		for (let word of span[1].split(/\s+/)) {
			word = word
				.replace(/^[("'[]+/, "")
				.replace(/[)"',;.\]]+$/, "")
				.replace(/^\.\//, "")
				.replace(/(:\d+(-\d+)?|#L\d+.*)$/, "");
			if (!ROOTS.some((r) => word === r || word.startsWith(`${r}/`))) continue;
			if (word.includes("…") || word.includes("...")) continue;
			for (const p of expandBraces(word)) out.add(p.replace(/<[^>/]+>/g, "*"));
		}
	}
	return [...out].sort();
}

// ── Matching ─────────────────────────────────────────────────

function globToRegExp(glob) {
	let re = "";
	for (let i = 0; i < glob.length; i++) {
		const c = glob[i];
		if (c === "*") {
			if (glob[i + 1] === "*") {
				i++;
				if (glob[i + 1] === "/") {
					i++;
					re += "(?:.*/)?"; // `**/` also matches zero directories
				} else {
					re += ".*";
				}
			} else {
				re += "[^/]*";
			}
		} else {
			re += c.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
		}
	}
	return new RegExp(`^${re}$`);
}

// Every file and directory below the roots, as repo-relative posix paths.
function listTree(root) {
	const all = [];
	const walk = (rel) => {
		for (const e of readdirSync(join(root, rel), { withFileTypes: true })) {
			if (e.name === "node_modules" || e.name === ".git") continue;
			const p = `${rel}/${e.name}`;
			all.push(e.isDirectory() ? `${p}/` : p);
			if (e.isDirectory()) walk(p);
		}
	};
	for (const r of ROOTS) if (existsSync(join(root, r))) walk(r);
	return all;
}

// Paths from `paths` that do not exist under `root` and are not exempt.
export function findMissingPaths(paths, root, exempt = []) {
	const exemptRes = exempt.flatMap(expandBraces).map(globToRegExp);
	const tree = paths.some((p) => p.includes("*")) ? listTree(root) : [];
	return paths.filter((p) => {
		if (exemptRes.some((re) => re.test(p))) return false;
		if (p.includes("*")) {
			const re = globToRegExp(p);
			return !tree.some((t) => re.test(t) || re.test(t.replace(/\/$/, "")));
		}
		const full = join(root, p);
		if (!existsSync(full)) return true;
		return p.endsWith("/") && !statSync(full).isDirectory();
	});
}

// Exempt entries (brace-expanded) that are no longer needed: the entry cites
// nothing in `paths`, or every path it cites now exists under `root`.
export function findStaleExempt(paths, root, exempt) {
	const stale = [];
	for (const e of exempt.flatMap(expandBraces)) {
		const re = globToRegExp(e);
		const cited = paths.filter((p) => re.test(p));
		if (cited.length === 0) stale.push(`${e} (cites nothing)`);
		else if (findMissingPaths(cited, root).length === 0)
			stale.push(`${e} (every cited path exists)`);
	}
	return stale;
}

// ── Extraction ───────────────────────────────────────────────

section("Plan paths — extraction");

test("picks backticked repo paths and ignores other spans", () => {
	const md = "See `src/a.js`, `npm run build`, `docs/x.md` and `test/unit/`.";
	assertEqual(extractPlanPaths(md).join(","), "src/a.js,test/unit/");
});

test("splits commands, strips punctuation, line numbers and ./", () => {
	const md =
		"`git mv test/e2e/perf test/perf`, `./scripts/x.js:12-14`, `(src/y.js)`.";
	assertEqual(
		extractPlanPaths(md).join(","),
		"scripts/x.js,src/y.js,test/e2e/perf,test/perf",
	);
});

test("expands braces and turns placeholders into wildcards", () => {
	const md = "`src/b/{js,wasm}/n.js` `stdlib/<pkg>/*.go`";
	assertEqual(
		extractPlanPaths(md).join(","),
		"src/b/js/n.js,src/b/wasm/n.js,stdlib/*/*.go",
	);
});

test("skips fenced blocks, elisions and non-root shorthand", () => {
	const md = "```\n`src/in-fence.js`\n```\n`src/…` `*/stdlib/` `wasm/index.js`";
	assertEqual(extractPlanPaths(md).length, 0);
});

// ── Existence ────────────────────────────────────────────────

section("Plan paths — existence");

const FILES = {
	"src/a.js": "",
	"src/cli/x.js": "",
	"stdlib/m/m.go": "",
	"test/unit/t.test.js": "",
};

test("reports a missing file, accepts files and directories", () => {
	withTempDir(FILES, (dir) => {
		const missing = findMissingPaths(
			["src/a.js", "src/cli/", "src/gone.js", "src/cli-core.js"],
			dir,
		);
		assertEqual(missing.join(","), "src/gone.js,src/cli-core.js");
	});
});

test("a trailing slash needs a directory, not a file", () => {
	withTempDir(FILES, (dir) => {
		assertEqual(findMissingPaths(["src/a.js/"], dir).join(","), "src/a.js/");
	});
});

test("globs need at least one match; ** crosses directories", () => {
	withTempDir(FILES, (dir) => {
		const missing = findMissingPaths(
			["src/cli/*", "src/*.js", "stdlib/**/*.go", "src/none/*", "test/*/*.rs"],
			dir,
		);
		assertEqual(missing.join(","), "src/none/*,test/*/*.rs");
	});
});

test("exempt globs hide paths a plan creates itself", () => {
	withTempDir(FILES, (dir) => {
		const missing = findMissingPaths(
			["src/new.js", "test/unit/s/a.test.js", "test/unit/s/h.js", "src/x.js"],
			dir,
			["src/new.js", "test/unit/s/*"],
		);
		assertEqual(missing.join(","), "src/x.js");
	});
});

test("the root comes from the test file, not the working directory", () => {
	assert(existsSync(join(REPO_ROOT, "package.json")), "REPO_ROOT is the repo");
	assert(
		existsSync(join(REPO_ROOT, "test/unit/compiler/plan-paths.test.js")),
		"REPO_ROOT holds this test",
	);
});

test("an exempt entry is stale once every path it cites exists", () => {
	const paths = ["src/a.js", "src/new.js", "test/unit/s/a.test.js"];
	const exempt = ["src/new.js", "test/unit/s/*"];
	withTempDir(FILES, (dir) => {
		assertEqual(findStaleExempt(paths, dir, exempt).join(","), "");
	});
	withTempDir({ ...FILES, "src/new.js": "" }, (dir) => {
		assertEqual(
			findStaleExempt(paths, dir, exempt).join(","),
			"src/new.js (every cited path exists)",
		);
	});
	withTempDir({ ...FILES, "test/unit/s/a.test.js": "" }, (dir) => {
		assertEqual(
			findStaleExempt(paths, dir, exempt).join(","),
			"test/unit/s/* (every cited path exists)",
		);
	});
});

test("an exempt entry that cites nothing is stale", () => {
	withTempDir(FILES, (dir) => {
		assertEqual(
			findStaleExempt(["src/a.js"], dir, ["src/{x,a}.js"]).join(","),
			"src/x.js (cites nothing),src/a.js (every cited path exists)",
		);
	});
});

// ── The real plans ───────────────────────────────────────────

for (const { file, exempt } of PLANS) {
	section(`Plan paths — ${file}`);

	test(`every path cited in ${file} exists`, () => {
		const paths = extractPlanPaths(readFileSync(join(REPO_ROOT, file), "utf8"));
		assert(paths.length > 0, `${file} cites no repo paths`);
		const missing = findMissingPaths(paths, REPO_ROOT, exempt);
		assert(missing.length === 0, `missing in ${file}: ${missing.join(", ")}`);
	});

	test(`${file}: every exempt entry is still needed`, () => {
		const paths = extractPlanPaths(readFileSync(join(REPO_ROOT, file), "utf8"));
		const stale = findStaleExempt(paths, REPO_ROOT, exempt);
		assert(
			stale.length === 0,
			`stale exempt entries in ${file}: ${stale.join(", ")}`,
		);
	});
}
