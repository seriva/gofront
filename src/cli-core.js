// CLI compilation core — extracted for direct import in tests.
// index.js retains only arg parsing, file I/O, watch mode, and process.exit.

import {
	copyFileSync,
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	rmSync,
	statSync,
	watch,
	writeFileSync,
} from "node:fs";
import {
	basename,
	dirname,
	extname,
	isAbsolute,
	join,
	relative,
	resolve,
	sep,
} from "node:path";
import { copyAssets } from "./asset-manager.js";
import { compileDir, compileSingleFile } from "./compiler.js";
import { createDevServer } from "./dev-server.js";
import { minify } from "./minifier.js";
import { generatePwa } from "./pwa.js";
import { runTests } from "./test-runner.js";
import { bundleVendor } from "./vendor.js";

const GOFRONT_VERSION = JSON.parse(
	readFileSync(new URL("../package.json", import.meta.url), "utf8"),
).version;

export function runCompile(inputPath, isDir, options) {
	const {
		sourceMap = false,
		outputFile = null,
		dumpTokens = false,
		dumpAst = false,
	} = options ?? {};

	if (isDir) {
		const outputDir = outputFile ? dirname(resolve(outputFile)) : resolve(".");
		return compileDir(inputPath, { sourceMap, outputDir });
	}

	return compileSingleFile(inputPath, {
		sourceMap,
		outputFile,
		dumpTokens,
		dumpAst,
	});
}

export function maybeMinify(js, options) {
	const {
		minify: doMinify = false,
		mangle = false,
		sourceMap = false,
	} = options ?? {};
	if (!doMinify) return js;
	if (sourceMap)
		throw new Error("--source-map and --minify cannot be used together");
	return minify(js, { mangle });
}

function sanitizeProjectName(dirPath) {
	const base = basename(resolve(dirPath));
	const clean = base
		.toLowerCase()
		.replace(/[^a-z0-9_-]/g, "-")
		.replace(/^[0-9_-]+/, "");
	return clean || "gofront-app";
}

function checkScaffoldConflicts(targetDir, filePaths) {
	const legacyMain = join(targetDir, "main.go");
	const allToCheck = [...filePaths, legacyMain];
	for (const p of allToCheck) {
		if (existsSync(p)) {
			throw new Error(`${p} already exists — nothing written`);
		}
	}
}

function getScaffoldTemplates(targetDir) {
	const projName = sanitizeProjectName(targetDir);
	const indexPath = join(targetDir, "app", "index.html");
	const mainPath = join(targetDir, "app", "src", "main.go");
	const gitignorePath = join(targetDir, ".gitignore");
	const pkgPath = join(targetDir, "package.json");

	const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${projName}</title>
</head>
<body>
  <div id="app"></div>
  <script type="module" src="app.js"></script>
</body>
</html>
`;

	const mainGo = `package main

func main() {
	console.log("Hello from GoFront!")
}
`;

	const gitignore = `dist/
public/
app/vendor.js
app/app.js
node_modules/
`;

	const pkgJson = `${JSON.stringify(
		{
			name: projName,
			type: "module",
			scripts: {
				dev: "gofront dev",
				build: "gofront build",
				test: "gofront test",
				check: "gofront check",
			},
			dependencies: {},
			devDependencies: { gofront: `^${GOFRONT_VERSION}` },
		},
		null,
		2,
	)}\n`;

	return [
		{ path: indexPath, content: html },
		{ path: mainPath, content: mainGo },
		{ path: gitignorePath, content: gitignore },
		{ path: pkgPath, content: pkgJson },
	];
}

export function handleInit(targetDir) {
	try {
		mkdirSync(targetDir, { recursive: true });
	} catch (e) {
		throw new Error(`cannot create '${targetDir}': ${e.message}`);
	}

	const templates = getScaffoldTemplates(targetDir);
	checkScaffoldConflicts(
		targetDir,
		templates.map((t) => t.path),
	);

	for (const { path: filePath, content } of templates) {
		try {
			mkdirSync(dirname(filePath), { recursive: true });
			writeFileSync(filePath, content);
		} catch (e) {
			throw new Error(`cannot write '${filePath}': ${e.message}`);
		}
	}

	const mainPath = join(targetDir, "app", "src", "main.go");
	return {
		mainPath,
		files: templates.map((t) => t.path),
	};
}

export async function handlePrep(targetDir, options = {}) {
	const resolvedTarget = resolve(targetDir);
	const assets = copyAssets(resolvedTarget, options.assetConfig);
	const vendor = await bundleVendor(resolvedTarget, options.vendorConfig);
	return { assets, vendor };
}

export function parsePrepArgs(argv) {
	const positional = argv.filter((a) => !a.startsWith("-"));
	return {
		targetDir: positional[0] ?? ".",
		vendorConfig: argv.includes("--minify") ? { minify: true } : {},
	};
}

export function formatPrepSummary({ assets, vendor }) {
	const lines = [];
	if (assets.copied > 0 || assets.skipped > 0) {
		lines.push(`copied ${assets.copied} assets (${assets.skipped} skipped)`);
	}
	if (vendor.bundled?.length > 0) {
		const dest = Array.isArray(vendor.dest)
			? vendor.dest.join(", ")
			: vendor.dest;
		const min = vendor.minify ? " (minified)" : "";
		lines.push(
			`bundled ${vendor.bundled.length} vendor dependencies → ${dest}${min}`,
		);
	}
	return lines;
}

export function parseTestArgs(argv) {
	let run = null;
	const positional = [];
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (arg === "-run" || arg === "--run") {
			run = argv[++i] ?? null;
		} else if (arg.startsWith("-run=") || arg.startsWith("--run=")) {
			run = arg.slice(arg.indexOf("=") + 1);
		} else if (!arg.startsWith("-")) {
			positional.push(arg);
		}
	}
	return {
		targetDir: positional[0] ?? ".",
		verbose: argv.includes("-v"),
		dom: argv.includes("--dom"),
		run,
	};
}

export function handleTest(targetDir = ".", options = {}) {
	let testTarget = targetDir;
	try {
		const project = detectProject(targetDir);
		const targetPath = resolve(targetDir);
		if (
			statSync(targetPath).isDirectory() &&
			targetPath === project.projectRoot &&
			project.srcDir !== project.projectRoot
		) {
			testTarget = statSync(project.srcDir).isDirectory()
				? project.srcDir
				: dirname(project.srcDir);
		}
	} catch {}
	return runTests(testTarget, options);
}

// ── Project detection ─────────────────────────────────────────

function loadProjectConfig(projectRoot) {
	const gofrontJson = join(projectRoot, "gofront.json");
	if (existsSync(gofrontJson)) {
		try {
			return JSON.parse(readFileSync(gofrontJson, "utf8"));
		} catch {}
	}
	const pkgJson = join(projectRoot, "package.json");
	if (existsSync(pkgJson)) {
		try {
			const pkg = JSON.parse(readFileSync(pkgJson, "utf8"));
			if (pkg.gofront && typeof pkg.gofront === "object") {
				return pkg.gofront;
			}
		} catch {}
	}
	return {};
}

function resolveSrcDir(projectRoot, config) {
	const src = config.src || config.input;
	if (src) return isAbsolute(src) ? src : resolve(projectRoot, src);
	if (existsSync(join(projectRoot, "app", "src"))) {
		return join(projectRoot, "app", "src");
	}
	if (existsSync(join(projectRoot, "src"))) {
		return join(projectRoot, "src");
	}
	if (existsSync(join(projectRoot, "main.go"))) {
		try {
			const entries = readdirSync(projectRoot);
			const srcFiles = entries.filter(
				(e) =>
					(e.endsWith(".go") || e.endsWith(".templ")) &&
					!e.endsWith("_test.go"),
			);
			if (srcFiles.length === 1 && srcFiles[0] === "main.go") {
				return join(projectRoot, "main.go");
			}
		} catch {}
	}
	return projectRoot;
}

function resolveServeDir(projectRoot, config) {
	const serve = config.serveDir;
	if (serve) return isAbsolute(serve) ? serve : resolve(projectRoot, serve);
	if (existsSync(join(projectRoot, "app", "index.html"))) {
		return join(projectRoot, "app");
	}
	if (existsSync(join(projectRoot, "index.html"))) {
		return projectRoot;
	}
	if (existsSync(join(projectRoot, "public", "index.html"))) {
		return join(projectRoot, "public");
	}
	return existsSync(join(projectRoot, "app"))
		? join(projectRoot, "app")
		: projectRoot;
}

function resolveOutDir(projectRoot, config) {
	const out =
		config.outDir ||
		config.dist ||
		(typeof config.public === "string" ? config.public : null);
	if (out) return isAbsolute(out) ? out : resolve(projectRoot, out);
	return join(projectRoot, "public");
}

function resolveDevOutputFile(projectRoot, serveDir, config) {
	const out = config.output;
	if (out) return isAbsolute(out) ? out : resolve(projectRoot, out);
	if (existsSync(join(projectRoot, "app"))) {
		return join(projectRoot, "app", "app.js");
	}
	return join(serveDir, "app.js");
}

export function detectProject(dir = ".") {
	const projectRoot = resolve(dir);
	const config = loadProjectConfig(projectRoot);
	const srcDir = resolveSrcDir(projectRoot, config);
	const serveDir = resolveServeDir(projectRoot, config);
	const devOutputFile = resolveDevOutputFile(projectRoot, serveDir, config);
	const outDir = resolveOutDir(projectRoot, config);
	const port = config.port || config.serverPort || 3000;

	return {
		projectRoot,
		srcDir,
		serveDir,
		devOutputFile,
		outDir,
		port,
		config,
	};
}

// ── check command ─────────────────────────────────────────────

export function parseCheckArgs(argv) {
	const positional = argv.filter((a) => !a.startsWith("-"));
	return {
		targetDir: positional[0] ?? ".",
	};
}

export function handleCheck(targetDir = ".", options = {}) {
	const project = detectProject(targetDir);
	const targetPath = resolve(targetDir);
	let isDir = false;
	try {
		isDir = statSync(targetPath).isDirectory();
	} catch (e) {
		throw new Error(`cannot access '${targetDir}': ${e.message}`);
	}

	let compileTarget = targetPath;
	if (
		isDir &&
		targetPath === project.projectRoot &&
		project.srcDir !== project.projectRoot
	) {
		compileTarget = project.srcDir;
	}

	const targetIsDir = statSync(compileTarget).isDirectory();
	const startMs = performance.now();
	runCompile(compileTarget, targetIsDir, { ...options });
	const elapsedMs = (performance.now() - startMs).toFixed(0);
	return { target: targetDir, compileTarget, elapsedMs };
}

// ── build command ─────────────────────────────────────────────

export function parseBuildArgs(argv) {
	let outDir = null;
	const positional = [];
	const pwa = argv.includes("--pwa");
	const sourceMap = argv.includes("--source-map");
	const noMinify = argv.includes("--no-minify");
	const noMangle = argv.includes("--no-mangle");

	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (arg === "-o" || arg === "--out-dir" || arg === "--out") {
			outDir = argv[++i] ?? null;
		} else if (arg.startsWith("--out-dir=")) {
			outDir = arg.slice(arg.indexOf("=") + 1);
		} else if (!arg.startsWith("-")) {
			positional.push(arg);
		}
	}

	return {
		targetDir: positional[0] ?? ".",
		outDir,
		pwa,
		sourceMap,
		minify: !noMinify,
		mangle: !noMangle && !noMinify,
	};
}

function isSubdirectory(parent, child) {
	const rel = relative(parent, child);
	return (
		rel !== "" &&
		rel !== ".." &&
		!rel.startsWith(`..${sep}`) &&
		!isAbsolute(rel)
	);
}

function cleanOutputDir(outDir, project, srcDir) {
	const resolvedOut = resolve(outDir);
	const resolvedRoot = resolve(project.projectRoot);
	const protectedDirs = [
		resolvedRoot,
		resolve(srcDir),
		resolve(project.serveDir),
	];

	// Only ever delete a directory inside the project that holds no sources.
	const isSafe =
		isSubdirectory(resolvedRoot, resolvedOut) &&
		protectedDirs.every(
			(p) => p !== resolvedOut && !isSubdirectory(resolvedOut, p),
		);

	if (isSafe && existsSync(resolvedOut)) {
		rmSync(resolvedOut, { recursive: true, force: true });
	}
	mkdirSync(resolvedOut, { recursive: true });
}

const STATIC_ASSET_EXTS = new Set([
	".html",
	".css",
	".js",
	".mjs",
	".json",
	".webmanifest",
	".png",
	".jpg",
	".jpeg",
	".gif",
	".svg",
	".webp",
	".avif",
	".ico",
	".woff",
	".woff2",
	".ttf",
	".otf",
	".mp3",
	".wav",
	".ogg",
	".mp4",
	".webm",
	".txt",
	".xml",
	".wasm",
]);

const ROOT_CONFIG_EXTS = new Set([".js", ".mjs", ".json"]);

// Whether a file in the served directory is a web asset worth copying to the build output.
function isStaticAsset(name, atProjectRoot) {
	const ext = extname(name).toLowerCase();
	if (!STATIC_ASSET_EXTS.has(ext)) return false;
	// At the project root, .js/.json files are tooling config, not web assets.
	if (atProjectRoot && ROOT_CONFIG_EXTS.has(ext))
		return name === "manifest.json";
	return true;
}

// Copies static web assets (css, images, fonts, ...) from the served directory into the build output.
function copyServeDirAssets(project, outDir, srcDir) {
	const serveDir = resolve(project.serveDir);
	const out = resolve(outDir);
	if (!existsSync(serveDir) || serveDir === out) return 0;
	const isRoot = serveDir === resolve(project.projectRoot);
	const skipDirs = [out, resolve(srcDir)];
	const devOutput = resolve(project.devOutputFile);
	const skipFiles = new Set([devOutput, `${devOutput}.map`]);
	let copied = 0;

	const copyFile = (full) => {
		const dest = join(out, relative(serveDir, full));
		if (existsSync(dest)) return;
		mkdirSync(dirname(dest), { recursive: true });
		copyFileSync(full, dest);
		copied++;
	};
	const walk = (dir) => {
		for (const entry of readdirSync(dir, { withFileTypes: true })) {
			if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
			const full = join(dir, entry.name);
			if (entry.isDirectory()) {
				if (!skipDirs.some((d) => d === full || isSubdirectory(d, full)))
					walk(full);
			} else if (
				entry.isFile() &&
				!skipFiles.has(full) &&
				isStaticAsset(entry.name, isRoot)
			) {
				copyFile(full);
			}
		}
	};
	walk(serveDir);
	return copied;
}

function copyReleaseAssets(project, outDir, srcDir, assetConfig) {
	const assetResult = copyAssets(project.projectRoot, assetConfig);

	const candidates = [
		join(project.serveDir, "index.html"),
		join(project.projectRoot, "index.html"),
		join(project.projectRoot, "app", "index.html"),
	];
	const destIndex = join(outDir, "index.html");
	for (const candidate of candidates) {
		if (existsSync(candidate) && resolve(candidate) !== resolve(destIndex)) {
			copyFileSync(candidate, destIndex);
			break;
		}
	}
	copyServeDirAssets(project, outDir, srcDir);
	return assetResult;
}

function collectOutputFiles(outDir) {
	const files = [];
	try {
		for (const name of readdirSync(outDir)) {
			const filePath = join(outDir, name);
			const stat = statSync(filePath);
			if (stat.isFile()) {
				files.push({ name, size: stat.size, path: filePath });
			}
		}
	} catch {}
	return files;
}

export function formatBuildSummary({ outDir, elapsedMs, files, pwa }) {
	const lines = [`build complete in ${elapsedMs}ms → ${outDir}`];
	for (const f of files) {
		const sizeKb = (f.size / 1024).toFixed(1);
		lines.push(`  ${f.name} (${sizeKb} kB)`);
	}
	if (pwa) {
		lines.push(
			`  pwa: generated sw.js (${pwa.assetsCount} cached assets, ${pwa.version})`,
		);
	}
	return lines;
}

export async function handleBuild(targetDir = ".", options = {}) {
	const startMs = performance.now();
	const project = detectProject(targetDir);
	const outDir = options.outDir ? resolve(options.outDir) : project.outDir;
	const srcDir = options.srcDir ? resolve(options.srcDir) : project.srcDir;

	cleanOutputDir(outDir, project, srcDir);

	const isDir = statSync(srcDir).isDirectory();
	const outputFile = join(outDir, "app.js");
	const compileResult = runCompile(srcDir, isDir, {
		outputFile,
		sourceMap: options.sourceMap ?? false,
	});

	const doMinify = options.minify ?? true;
	const doMangle = options.mangle ?? true;
	const js = maybeMinify(compileResult.js, {
		minify: doMinify,
		mangle: doMangle,
		sourceMap: options.sourceMap ?? false,
	});
	writeFileSync(outputFile, `${js}\n`);

	let vendor = null;
	try {
		vendor = await bundleVendor(project.projectRoot, {
			minify: doMinify,
			...options.vendorConfig,
			dest: join(outDir, "vendor.js"),
		});
	} catch (e) {
		console.warn(`gofront: vendor bundle warning: ${e.message}`);
	}

	const assets = copyReleaseAssets(
		project,
		outDir,
		srcDir,
		options.assetConfig,
	);

	let pwa = null;
	if (options.pwa) {
		pwa = generatePwa(outDir);
	}

	const elapsedMs = (performance.now() - startMs).toFixed(0);
	const files = collectOutputFiles(outDir);

	return {
		outDir,
		srcDir,
		elapsedMs,
		files,
		assets,
		vendor,
		pwa,
	};
}

export { generatePwa };

// ── dev command ───────────────────────────────────────────────

export function parseDevArgs(argv) {
	let port = null;
	let outputFile = null;
	const positional = [];
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (arg === "-p" || arg === "--port") {
			port = parseInt(argv[++i], 10);
		} else if (arg.startsWith("--port=")) {
			port = parseInt(arg.slice(arg.indexOf("=") + 1), 10);
		} else if (arg === "-o" || arg === "--output") {
			outputFile = argv[++i] ?? null;
		} else if (!arg.startsWith("-")) {
			positional.push(arg);
		}
	}
	return {
		targetDir: positional[0] ?? ".",
		port: Number.isNaN(port) ? null : port,
		outputFile,
	};
}

function buildDevOnce(
	{ srcDir, isDir, outputFile, sourceMap, devServer },
	changedFile = null,
) {
	try {
		const startMs = performance.now();
		const result = runCompile(srcDir, isDir, {
			outputFile,
			sourceMap: sourceMap ?? true,
		});
		mkdirSync(dirname(outputFile), { recursive: true });
		writeFileSync(outputFile, `${result.js}\n`);
		const elapsedMs = (performance.now() - startMs).toFixed(0);
		const note = changedFile ? ` — ${changedFile} changed` : "";
		console.error(`gofront: OK — wrote ${outputFile} (${elapsedMs}ms${note})`);
		devServer.notify();
	} catch (e) {
		console.error("gofront: ERROR");
		for (const line of e.message.split("\n")) console.error(`  ${line}`);
		devServer.notifyError(e);
	}
}

function createSrcWatcher(watchTarget, onCss, onRebuild) {
	try {
		return watch(watchTarget, { recursive: true }, (_event, filename) => {
			if (!filename) return;
			if (filename.endsWith(".css")) {
				onCss(filename);
			} else if (filename.endsWith(".go") || filename.endsWith(".templ")) {
				onRebuild(filename);
			}
		});
	} catch {
		return null;
	}
}

function createServeWatcher(serveDir, watchTarget, onCss, onHtml) {
	if (!existsSync(serveDir) || resolve(serveDir) === resolve(watchTarget)) {
		return null;
	}
	try {
		return watch(serveDir, { recursive: true }, (_event, filename) => {
			if (!filename) return;
			if (filename.endsWith(".css")) {
				onCss(filename);
			} else if (filename.endsWith(".html")) {
				onHtml();
			}
		});
	} catch {
		return null;
	}
}

function setupDevWatchers(config) {
	let debounce = null;
	let cssDebounce = null;
	let htmlDebounce = null;

	const handleCss = (filename) => {
		try {
			copyAssets(config.project.projectRoot, config.assetConfig);
		} catch {}
		config.devServer.notifyCss(filename);
	};

	const watchers = [];
	const srcWatcher = createSrcWatcher(
		config.watchTarget,
		(fn) => {
			clearTimeout(cssDebounce);
			cssDebounce = setTimeout(() => handleCss(fn), 50);
		},
		(fn) => {
			clearTimeout(debounce);
			debounce = setTimeout(() => buildDevOnce(config, fn), 80);
		},
	);
	if (srcWatcher) watchers.push(srcWatcher);

	const serveWatcher = createServeWatcher(
		config.serveDir,
		config.watchTarget,
		(fn) => {
			clearTimeout(cssDebounce);
			cssDebounce = setTimeout(() => handleCss(fn), 50);
		},
		() => {
			clearTimeout(htmlDebounce);
			// Typed reload keeps a pending build error visible after the page reloads.
			htmlDebounce = setTimeout(
				() => config.devServer.notify({ type: "reload" }),
				50,
			);
		},
	);
	if (serveWatcher) watchers.push(serveWatcher);

	return {
		watchers,
		close: () => {
			clearTimeout(debounce);
			clearTimeout(cssDebounce);
			clearTimeout(htmlDebounce);
			for (const w of watchers) {
				try {
					w?.close();
				} catch {}
			}
		},
	};
}

export async function handleDev(targetDir = ".", options = {}) {
	const project = detectProject(targetDir);
	const port = options.port ?? project.port ?? 3000;
	const serveDir = options.serveDir
		? resolve(options.serveDir)
		: project.serveDir;
	const srcDir = options.srcDir ? resolve(options.srcDir) : project.srcDir;
	const outputFile = options.outputFile
		? resolve(options.outputFile)
		: project.devOutputFile;

	copyAssets(project.projectRoot, options.assetConfig);

	const isDir = statSync(srcDir).isDirectory();
	const devServer = createDevServer(serveDir, port, {
		...options,
		silent: true,
	});
	let initialError = null;

	try {
		const result = runCompile(srcDir, isDir, {
			outputFile,
			sourceMap: options.sourceMap ?? true,
		});
		mkdirSync(dirname(outputFile), { recursive: true });
		writeFileSync(outputFile, `${result.js}\n`);
	} catch (err) {
		initialError = err;
		devServer.notifyError(err);
	}

	let watcherController = null;
	if (options.watch !== false) {
		const watchTarget = isDir ? srcDir : dirname(srcDir);
		watcherController = setupDevWatchers({
			watchTarget,
			srcDir,
			isDir,
			outputFile,
			sourceMap: options.sourceMap,
			devServer,
			project,
			serveDir,
			assetConfig: options.assetConfig,
		});
	}

	return {
		devServer,
		project,
		port,
		serveDir,
		srcDir,
		outputFile,
		initialError,
		close: async () => {
			watcherController?.close();
			await devServer.close();
		},
	};
}
