// GoFront test suite — prep command & vendor bundling
import { spawnSync } from "node:child_process";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { handlePrep } from "../../../src/cli-core.js";
import {
	bundleVendor,
	generateVendorEntry,
	getExportNames,
	loadVendorConfig,
} from "../../../src/vendor.js";
import {
	assert,
	assertContains,
	assertEqual,
	ROOT,
	section,
	summarize,
	test,
} from "../helpers.js";

const CLI = join(ROOT, "src", "index.js");

function cli(args, cwd) {
	const r = spawnSync(process.execPath, [CLI, ...args], {
		encoding: "utf8",
		cwd,
	});
	return {
		stdout: r.stdout ?? "",
		stderr: r.stderr ?? "",
		code: r.status ?? 1,
	};
}

section("vendor — entry point generation & export names");

test("getExportNames derives generic names only (no hardcoded package aliases)", () => {
	const emailNames = getExportNames("@emailjs/browser");
	assert(emailNames.includes("@emailjs/browser"), "expected full name");
	assert(emailNames.includes("browser"), "expected unscoped base name");
	assert(!emailNames.includes("emailjs"), "emailjs alias must not be built in");

	const fuseNames = getExportNames("fuse.js");
	assert(fuseNames.includes("fuse.js"), "expected full name");
	assert(fuseNames.includes("fuse_js"), "expected sanitised identifier");
	assert(!fuseNames.includes("Fuse"), "Fuse alias must not be built in");

	assert(!getExportNames("prismjs").includes("Prism"));
	assert(getExportNames("marked").includes("marked"));
});

test("getExportNames appends names from a globals mapping", () => {
	const globals = { "fuse.js": ["Fuse"], prismjs: "Prism" };
	assert(getExportNames("fuse.js", globals).includes("Fuse"));
	assert(getExportNames("prismjs", globals).includes("Prism"));
	assert(!getExportNames("marked", globals).includes("Fuse"));
});

test("generateVendorEntry creates valid import, window, and export code", () => {
	const entry = generateVendorEntry(["marked", "prismjs", "@emailjs/browser"], {
		prismjs: ["Prism"],
		"@emailjs/browser": ["emailjs"],
	});
	assertContains(entry, 'import * as _dep_0 from "marked";');
	assertContains(entry, 'import * as _dep_1 from "prismjs";');
	assertContains(entry, 'import * as _dep_2 from "@emailjs/browser";');
	assertContains(entry, 'window["marked"] = _dep_0.default || _dep_0;');
	assertContains(entry, 'window["Prism"] = _dep_1.default || _dep_1;');
	assertContains(entry, 'window["emailjs"] = _dep_2.default || _dep_2;');
	assertContains(entry, "_dep_0 as marked");
	assertContains(entry, "_dep_1 as prismjs");
});

test("generateVendorEntry without globals emits no package-specific aliases", () => {
	const entry = generateVendorEntry(["prismjs"]);
	assert(!entry.includes('window["Prism"]'), "no Prism alias without globals");
	assertContains(entry, 'window["prismjs"] = _dep_0.default || _dep_0;');
});

section("vendor — configuration loading");

test("loadVendorConfig defaults to app/vendor.js when app/ exists", () => {
	const dir = mkdtempSync(join(tmpdir(), "gofront-vendor-cfg-"));
	try {
		mkdirSync(join(dir, "app"));
		writeFileSync(
			join(dir, "package.json"),
			JSON.stringify({
				dependencies: { marked: "^18.0.0" },
			}),
		);

		const config = loadVendorConfig(dir);
		assertEqual(config.dest, "app/vendor.js");
		assertEqual(config.packages.length, 1);
		assertEqual(config.packages[0], "marked");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("loadVendorConfig respects explicit vendor string in package.json", () => {
	const dir = mkdtempSync(join(tmpdir(), "gofront-vendor-cfgstr-"));
	try {
		writeFileSync(
			join(dir, "package.json"),
			JSON.stringify({
				vendor: "public/vendor.js",
				dependencies: { marked: "^18.0.0" },
			}),
		);

		const config = loadVendorConfig(dir);
		assertEqual(config.dest, "public/vendor.js");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("loadVendorConfig parses minify flag and multi-dest array", () => {
	const dir = mkdtempSync(join(tmpdir(), "gofront-vendor-cfgmult-"));
	try {
		writeFileSync(
			join(dir, "package.json"),
			JSON.stringify({
				vendor: {
					dest: ["app/vendor.js", "public/vendor.js"],
					minify: true,
				},
				dependencies: { marked: "^18.0.0" },
			}),
		);

		const config = loadVendorConfig(dir);
		assertEqual(Array.isArray(config.dest), true);
		assertEqual(config.dest.length, 2);
		assertEqual(config.dest[0], "app/vendor.js");
		assertEqual(config.dest[1], "public/vendor.js");
		assertEqual(config.minify, true);
		assertEqual(Object.keys(config.globals).length, 0);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("loadVendorConfig reads globals; gofront.json overrides package.json", () => {
	const dir = mkdtempSync(join(tmpdir(), "gofront-vendor-cfgglob-"));
	try {
		writeFileSync(
			join(dir, "package.json"),
			JSON.stringify({
				vendor: { globals: { "fuse.js": ["Fuse"] } },
				dependencies: { "fuse.js": "^7.0.0", prismjs: "^1.0.0" },
			}),
		);
		assertEqual(loadVendorConfig(dir).globals["fuse.js"][0], "Fuse");

		writeFileSync(
			join(dir, "gofront.json"),
			JSON.stringify({ vendor: { globals: { prismjs: "Prism" } } }),
		);
		const config = loadVendorConfig(dir);
		assertEqual(config.globals.prismjs[0], "Prism");
		assertEqual(config.globals["fuse.js"], undefined);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("loadVendorConfig rejects invalid globals shapes", () => {
	const dir = mkdtempSync(join(tmpdir(), "gofront-vendor-cfgbad-"));
	try {
		writeFileSync(
			join(dir, "package.json"),
			JSON.stringify({ vendor: { globals: { prismjs: 42 } } }),
		);
		let msg = "";
		try {
			loadVendorConfig(dir);
		} catch (e) {
			msg = e.message;
		}
		assertContains(msg, "vendor.globals");
		assertContains(msg, "prismjs");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("handlePrep preserves vendor.minify from package.json when CLI flag omitted", async () => {
	const dir = mkdtempSync(join(tmpdir(), "gofront-prep-cfgmin-"));
	try {
		writeFileSync(
			join(dir, "package.json"),
			JSON.stringify({
				vendor: { minify: true },
				dependencies: { marked: "^18.0.0" },
			}),
		);

		let capturedMinify = null;
		const mockBundler = {
			name: "mock",
			bundle: async ({ minify, dest }) => {
				capturedMinify = minify;
				const d = Array.isArray(dest) ? dest[0] : dest;
				writeFileSync(d, "// bundle");
			},
		};

		const { vendor } = await handlePrep(dir, {
			vendorConfig: { bundler: mockBundler },
		});
		assertEqual(vendor.minify, true);
		assertEqual(capturedMinify, true);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

section("vendor — bundling workflow");

test("bundleVendor returns early if no dependencies exist", async () => {
	const dir = mkdtempSync(join(tmpdir(), "gofront-vendor-nodep-"));
	try {
		writeFileSync(join(dir, "package.json"), JSON.stringify({}));
		const result = await bundleVendor(dir);
		assertEqual(result.bundled.length, 0);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("bundleVendor outputs warning and gracefully skips if no bundler installed", async () => {
	const dir = mkdtempSync(join(tmpdir(), "gofront-vendor-nobundler-"));
	try {
		writeFileSync(
			join(dir, "package.json"),
			JSON.stringify({
				dependencies: { marked: "^18.0.0" },
			}),
		);

		const result = await bundleVendor(dir);
		assertEqual(result.bundled.length, 0);
		assertEqual(result.bundler, null);
		assertEqual(result.reason, "no bundler installed");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("bundleVendor executes custom/mock bundler and produces output", async () => {
	const dir = mkdtempSync(join(tmpdir(), "gofront-vendor-mock-"));
	try {
		writeFileSync(
			join(dir, "package.json"),
			JSON.stringify({
				dependencies: { marked: "^18.0.0" },
			}),
		);

		let bundledCalled = false;
		const mockBundler = {
			name: "mock-bundler",
			bundle: async ({ dest, packages }) => {
				bundledCalled = true;
				writeFileSync(dest, `/* bundled: ${packages.join(", ")} */\n`);
			},
		};

		const result = await bundleVendor(dir, {
			bundler: mockBundler,
			dest: "dist/vendor.js",
		});

		assert(bundledCalled, "expected mock bundler to be called");
		assertEqual(result.bundled.length, 1);
		assertEqual(result.dest, "dist/vendor.js");
		const destFile = join(dir, "dist", "vendor.js");
		assert(existsSync(destFile), "expected dest file to exist");
		assertContains(readFileSync(destFile, "utf8"), "bundled: marked");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("bundleVendor throws error on destination directory traversal", async () => {
	const dir = mkdtempSync(join(tmpdir(), "gofront-vendor-trav-"));
	try {
		writeFileSync(
			join(dir, "package.json"),
			JSON.stringify({
				dependencies: { marked: "^18.0.0" },
			}),
		);

		let threw = false;
		try {
			await bundleVendor(dir, {
				dest: "../escape.js",
			});
		} catch (err) {
			threw = true;
			assertContains(err.message, "outside project directory");
		}
		assert(threw, "expected bundleVendor to throw on traversal attempt");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("bundleVendor supports minify and multi-destination copying", async () => {
	const dir = mkdtempSync(join(tmpdir(), "gofront-vendor-minmult-"));
	try {
		writeFileSync(
			join(dir, "package.json"),
			JSON.stringify({
				dependencies: { marked: "^18.0.0" },
			}),
		);

		let passedMinify = null;
		const mockBundler = {
			name: "mock-bundler",
			bundle: async ({ dest, minify }) => {
				passedMinify = minify;
				const dests = Array.isArray(dest) ? dest : [dest];
				for (const d of dests) {
					writeFileSync(d, `/* minified: ${minify} */`);
				}
			},
		};

		const result = await bundleVendor(dir, {
			bundler: mockBundler,
			dest: ["dist/app/vendor.js", "dist/public/vendor.js"],
			minify: true,
		});

		assertEqual(result.bundled.length, 1);
		assertEqual(result.minify, true);
		assertEqual(passedMinify, true);
		assert(existsSync(join(dir, "dist/app/vendor.js")));
		assert(existsSync(join(dir, "dist/public/vendor.js")));
		assertContains(
			readFileSync(join(dir, "dist/app/vendor.js"), "utf8"),
			"minified: true",
		);
		assertContains(
			readFileSync(join(dir, "dist/public/vendor.js"), "utf8"),
			"minified: true",
		);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

section("cli-core — handlePrep orchestration");

test("handlePrep orchestrates asset copy and vendor bundling", async () => {
	const dir = mkdtempSync(join(tmpdir(), "gofront-prep-core-"));
	try {
		writeFileSync(
			join(dir, "package.json"),
			JSON.stringify({
				assetCopy: [{ source: "logo.png", dest: "assets/logo.png" }],
				dependencies: { marked: "^18.0.0" },
			}),
		);
		writeFileSync(join(dir, "logo.png"), "png");

		const mockBundler = {
			name: "test-bundler",
			bundle: async ({ dest }) => {
				writeFileSync(dest, "// vendor");
			},
		};

		const result = await handlePrep(dir, {
			vendorConfig: { bundler: mockBundler, dest: "assets/vendor.js" },
		});

		assertEqual(result.assets.copied, 1);
		assertEqual(result.vendor.bundled.length, 1);
		assert(existsSync(join(dir, "assets", "logo.png")));
		assert(existsSync(join(dir, "assets", "vendor.js")));
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

section("CLI — gofront prep & --copy-assets commands");

test("gofront prep executes via CLI and copies assets", () => {
	const dir = mkdtempSync(join(tmpdir(), "gofront-prep-cli-"));
	try {
		writeFileSync(
			join(dir, "package.json"),
			JSON.stringify({
				assetCopy: [{ source: "font.woff2", dest: "fonts/font.woff2" }],
			}),
		);
		writeFileSync(join(dir, "font.woff2"), "woff-content");

		const { code, stderr } = cli(["prep", dir]);
		assertEqual(code, 0);
		assertContains(stderr, "copied 1 assets");
		assert(existsSync(join(dir, "fonts", "font.woff2")));
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("gofront --copy-assets flag copies static assets during build", () => {
	const dir = mkdtempSync(join(tmpdir(), "gofront-copyassets-cli-"));
	try {
		writeFileSync(
			join(dir, "package.json"),
			JSON.stringify({
				assetCopy: [{ source: "logo.svg", dest: "dist/logo.svg" }],
			}),
		);
		writeFileSync(join(dir, "logo.svg"), "<svg></svg>");
		writeFileSync(
			join(dir, "main.go"),
			'package main\nfunc main() { console.log("ok") }\n',
		);

		const { code, stderr } = cli(
			["main.go", "-o", "dist/app.js", "--copy-assets"],
			dir,
		);
		assertEqual(code, 0);
		assertContains(stderr, "copied 1 assets");
		assert(existsSync(join(dir, "dist", "app.js")));
		assert(existsSync(join(dir, "dist", "logo.svg")));
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("gofront --help lists prep and --copy-assets", () => {
	const { stdout, code } = cli(["--help"]);
	assertEqual(code, 0);
	assertContains(stdout, "gofront prep");
	assertContains(stdout, "--copy-assets");
});

test("gofront prep --minify executes via CLI and copies assets", () => {
	const dir = mkdtempSync(join(tmpdir(), "gofront-prep-mincli-"));
	try {
		writeFileSync(
			join(dir, "package.json"),
			JSON.stringify({
				assetCopy: [{ source: "icon.svg", dest: "assets/icon.svg" }],
			}),
		);
		writeFileSync(join(dir, "icon.svg"), "<svg></svg>");

		const { code, stderr } = cli(["prep", dir, "--minify"]);
		assertEqual(code, 0);
		assertContains(stderr, "copied 1 assets");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	process.exit((await summarize()) > 0 ? 1 : 0);
}
