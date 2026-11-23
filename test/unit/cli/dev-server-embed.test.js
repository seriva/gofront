// GoFront test suite — `gofront dev` rebuilds when an embedded file or a
// `.d.ts` file changes

import { mkdirSync, utimesSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { handleDev } from "../../../src/cli/cli-core.js";
import { compileDir } from "../../../src/compiler.js";
import { PackageCache } from "../../../src/link/package-cache.js";
import {
	assert,
	assertEqual,
	assertErrorContains,
	section,
	test,
	withTempDir,
} from "../helpers.js";

section("dev — watching embedded files and .d.ts imports");

let clock = Date.now() + 10_000;

function write(dir, rel, content) {
	const path = join(dir, rel);
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, content);
	clock += 1000;
	utimesSync(path, new Date(clock), new Date(clock));
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function until(what, cond, timeoutMs = 5000) {
	const end = Date.now() + timeoutMs;
	while (Date.now() < end) {
		if (cond()) return;
		await sleep(25);
	}
	throw new Error(`timed out waiting for ${what}`);
}

const APP = {
	"public/index.html": "<html><body></body></html>",
	"src/main.go": `package main

import (
	"./content"
	"./typed"
)

func main() { println(content.Text, typed.Name) }
`,
	"src/content/content.go": `package content

import _ "embed"

//go:embed asset.txt
var Text string

//go:embed style.css
var Style string
`,
	"src/content/asset.txt": "one",
	"src/content/style.css": "body { color: red }",
	"src/typed/typed.go": `package typed

import "js:./lib.d.ts"

var Name = "typed"
`,
	"src/typed/lib.d.ts": "export declare function hello(): string;\n",
};

// Starts a dev session that records every build and the package directories
// each one compiled.
async function session(dir) {
	const cache = new PackageCache();
	const builds = [];
	let errors = [];
	let seen = new Map();
	const dev = await handleDev(dir, {
		serve: false,
		copyAssets: false,
		packageCache: cache,
		onBuild: ({ changedFile }) => {
			const rebuilt = [];
			for (const [path, now] of cache.stats.packages) {
				const was = seen.get(path) ?? 0;
				if (now.misses > was)
					rebuilt.push(path.slice(resolve(dir, "src").length));
			}
			seen = new Map([...cache.stats.packages].map(([k, v]) => [k, v.misses]));
			builds.push({ changedFile, rebuilt: rebuilt.sort() });
		},
		onError: (e) => errors.push(e),
	});
	return {
		dev,
		builds,
		get errors() {
			return errors;
		},
		clearErrors: () => {
			errors = [];
		},
	};
}

async function watchedEdit(rel, content, expectRebuilt) {
	await withTempDir(APP, async (dir) => {
		const s = await session(dir);
		try {
			assertEqual(s.dev.initialError, null);
			const before = s.builds.length;
			write(dir, rel, content);
			await until(
				`a rebuild after editing ${rel}`,
				() => s.builds.length > before,
			);
			const last = s.builds.at(-1);
			assertEqual(last.changedFile, rel.slice("src/".length));
			assertEqual(last.rebuilt.join(), expectRebuilt);
		} finally {
			await s.dev.close();
		}
	});
}

test("editing an embedded text file rebuilds only its package", async () => {
	await watchedEdit("src/content/asset.txt", "two", "/content");
});

test("editing an embedded .css file rebuilds instead of only reloading styles", async () => {
	await watchedEdit(
		"src/content/style.css",
		"body { color: blue }",
		"/content",
	);
});

test("editing a js: .d.ts file rebuilds only its package", async () => {
	await watchedEdit(
		"src/typed/lib.d.ts",
		"export declare function hello(): number;\n",
		"/typed",
	);
});

test("a .css file nothing embeds does not rebuild", async () => {
	await withTempDir(APP, async (dir) => {
		const s = await session(dir);
		try {
			const before = s.builds.length;
			write(dir, "src/other.css", "p { margin: 0 }");
			await sleep(400);
			assertEqual(s.builds.length, before);
		} finally {
			await s.dev.close();
		}
	});
});

test("an embedded file created after a failed build triggers the rebuild", async () => {
	await withTempDir(
		{
			"public/index.html": "<html><body></body></html>",
			"src/main.go": `package main

import _ "embed"

//go:embed late.txt
var Text string

func main() { println(Text) }
`,
		},
		async (dir) => {
			const s = await session(dir);
			try {
				assert(s.dev.initialError !== null, "the missing file is an error");
				assertErrorContains([s.dev.initialError], "late.txt");
				write(dir, "src/late.txt", "here");
				await until(
					"the rebuild after creating the file",
					() => s.builds.length > 0,
				);
				assertEqual(s.builds.at(-1).changedFile, "late.txt");
			} finally {
				await s.dev.close();
			}
		},
	);
});

test("a build reports the embedded and .d.ts files of every package it compiled", () => {
	withTempDir(APP, (dir) => {
		const res = compileDir(join(dir, "src"), {
			packageCache: new PackageCache(),
		});
		const rel = res.watchedFiles.map((f) =>
			f.slice(join(dir, "src").length + 1),
		);
		assertEqual(
			rel.join(),
			"content/asset.txt,content/style.css,typed/lib.d.ts",
		);
	});
});
