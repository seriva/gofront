// Vendor dependency bundler for GoFront projects.
// Dynamically loads a bundler (rolldown or esbuild) from consumer devDependencies.

import {
	copyFileSync,
	existsSync,
	mkdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { loadProjectConfig } from "./project-config.js";

export function getExportNames(pkgName, globals = {}) {
	const base = pkgName.replace(/^@[^/]+\//, "");
	const clean = base.replace(/[^a-zA-Z0-9_]/g, "_");
	const names = new Set([pkgName, base, clean]);
	const extra = globals[pkgName];
	for (const name of Array.isArray(extra)
		? extra
		: typeof extra === "string"
			? [extra]
			: []) {
		if (typeof name === "string") names.add(name);
	}
	return [...names];
}

export function generateVendorEntry(packages, globals = {}, namedExports = {}) {
	const imports = [];
	const assignments = [];
	const exports = [];

	packages.forEach((pkg, idx) => {
		const id = `_dep_${idx}`;
		imports.push(`import * as ${id} from ${JSON.stringify(pkg)};`);

		const names = getExportNames(pkg, globals);
		for (const name of names) {
			assignments.push(
				`    window[${JSON.stringify(name)}] = ${id}.default || ${id};`,
			);
		}

		// Named export global assignments (e.g. window.h = preact.h)
		const pkgNamed = Object.create(null);
		const rawNamed = namedExports[pkg];
		const isSafeKey = (k) =>
			typeof k === "string" &&
			k !== "__proto__" &&
			k !== "prototype" &&
			k !== "constructor";

		if (Array.isArray(rawNamed)) {
			for (const name of rawNamed) {
				if (isSafeKey(name)) pkgNamed[name] = name;
			}
		} else if (rawNamed && typeof rawNamed === "object") {
			for (const [k, v] of Object.entries(rawNamed)) {
				if (isSafeKey(k) && isSafeKey(v)) pkgNamed[k] = v;
			}
		}

		if (typeof globals[pkg] === "object" && !Array.isArray(globals[pkg])) {
			for (const [k, v] of Object.entries(globals[pkg])) {
				if (isSafeKey(k) && isSafeKey(v)) pkgNamed[k] = v;
			}
		} else if (Array.isArray(globals[pkg])) {
			for (const item of globals[pkg]) {
				if (typeof item === "object" && item !== null) {
					for (const [k, v] of Object.entries(item)) {
						if (isSafeKey(k) && isSafeKey(v)) pkgNamed[k] = v;
					}
				}
			}
		}

		for (const [globalName, exportName] of Object.entries(pkgNamed)) {
			if (!isSafeKey(globalName) || !isSafeKey(exportName)) continue;
			assignments.push(
				`    window[${JSON.stringify(globalName)}] = ${id}[${JSON.stringify(exportName)}] !== undefined ? ${id}[${JSON.stringify(exportName)}] : (${id}.default ? ${id}.default[${JSON.stringify(exportName)}] : undefined);`,
			);
		}

		const cleanId = pkg
			.replace(/^@[^/]+\//, "")
			.replace(/[^a-zA-Z0-9_$]/g, "_");
		exports.push(`    ${id} as ${cleanId}`);
	});

	return `// Auto-generated GoFront vendor entry point
${imports.join("\n")}

if (typeof window !== "undefined") {
${assignments.join("\n")}
}

export {
${exports.join(",\n")}
};
`;
}

function findBundler(projectDir) {
	const root = resolve(projectDir);
	const pkgPath = join(root, "package.json");
	let req;
	if (existsSync(pkgPath)) {
		req = createRequire(pkgPath);
	} else {
		req = createRequire(join(root, "dummy.js"));
	}

	try {
		const path = req.resolve("rolldown");
		return { name: "rolldown", path };
	} catch {}

	try {
		const path = req.resolve("esbuild");
		return { name: "esbuild", path };
	} catch {}

	return null;
}

export function normalizeNamedExports(raw) {
	if (raw === undefined || raw === null) return {};
	if (typeof raw !== "object" || Array.isArray(raw)) return {};
	const out = {};
	for (const [pkg, value] of Object.entries(raw)) {
		if (Array.isArray(value)) {
			const map = {};
			for (const name of value) {
				if (typeof name === "string") map[name] = name;
			}
			out[pkg] = map;
		} else if (typeof value === "object" && value !== null) {
			out[pkg] = { ...value };
		}
	}
	return out;
}

// Normalises `vendor.globals` ({ pkg: string | string[] | object })
export function normalizeGlobals(raw) {
	if (raw === undefined || raw === null) return {};
	if (typeof raw !== "object" || Array.isArray(raw)) {
		throw new Error(
			"gofront: vendor.globals must be an object mapping package names to global names",
		);
	}
	const out = {};
	for (const [pkg, value] of Object.entries(raw)) {
		if (typeof value === "string") {
			out[pkg] = [value];
		} else if (Array.isArray(value)) {
			out[pkg] = value;
		} else if (typeof value === "object" && value !== null) {
			out[pkg] = value;
		} else {
			throw new Error(
				`gofront: vendor.globals[${JSON.stringify(pkg)}] must be a string, array, or object`,
			);
		}
	}
	return out;
}

export function loadVendorConfig(projectDir) {
	const pkgPath = join(projectDir, "package.json");
	let pkg = {};
	if (existsSync(pkgPath)) {
		try {
			pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
		} catch {}
	}

	const vendorConfig = loadProjectConfig(projectDir).vendor ?? null;
	const dependencies = Object.keys(pkg.dependencies ?? {});

	let dest = null;
	let packages = dependencies;
	let minify = false;
	let globals = {};
	let namedExports = {};

	if (typeof vendorConfig === "string") {
		dest = vendorConfig;
	} else if (vendorConfig && typeof vendorConfig === "object") {
		if (vendorConfig.dest) dest = vendorConfig.dest;
		if (Array.isArray(vendorConfig.packages)) packages = vendorConfig.packages;
		if (typeof vendorConfig.minify === "boolean") minify = vendorConfig.minify;
		globals = normalizeGlobals(vendorConfig.globals);
		namedExports = normalizeNamedExports(
			vendorConfig.namedExports ?? vendorConfig.exports,
		);
	}

	if (!dest) {
		dest = existsSync(join(projectDir, "app")) ? "app/vendor.js" : "vendor.js";
	}

	return { dest, packages, minify, globals, namedExports };
}

function resolveDestinationPaths(projectRoot, dest) {
	const destList = Array.isArray(dest) ? dest : [dest];
	if (destList.length === 0) {
		throw new Error(
			"gofront: at least one vendor destination must be specified",
		);
	}

	return destList.map((d) => {
		const fullPath = resolve(projectRoot, d);
		const relDest = relative(projectRoot, fullPath);
		if (relDest.startsWith("..") || isAbsolute(relDest)) {
			throw new Error(
				`gofront: vendor destination '${d}' is outside project directory`,
			);
		}
		return fullPath;
	});
}

export const NODE_BUILTINS = [
	"buffer",
	"events",
	"path",
	"util",
	"process",
	"stream",
	"crypto",
	"fs",
	"os",
	"http",
	"https",
	"net",
	"tls",
	"zlib",
	"url",
	"assert",
	"child_process",
];

export const NODE_POLYFILLS_TIP =
	"gofront: tip: npm package requires Node built-ins. Install @rolldown/plugin-node-polyfills:\n  npm install --save-dev @rolldown/plugin-node-polyfills";

export function isNodeBuiltinError(errorMsg) {
	if (typeof errorMsg !== "string") return false;
	const lower = errorMsg.toLowerCase();
	return NODE_BUILTINS.some(
		(mod) =>
			lower.includes(`"${mod}"`) ||
			lower.includes(`'${mod}'`) ||
			lower.includes(`node:${mod}`) ||
			lower.includes(`module '${mod}'`) ||
			lower.includes(`resolve "${mod}"`) ||
			lower.includes(`resolve '${mod}'`),
	);
}

export function findNodePolyfills(projectDir) {
	const root = resolve(projectDir);
	const pkgPath = join(root, "package.json");
	let req;
	if (existsSync(pkgPath)) {
		req = createRequire(pkgPath);
	} else {
		req = createRequire(join(root, "dummy.js"));
	}

	try {
		const path = req.resolve("@rolldown/plugin-node-polyfills");
		return { name: "node-polyfills", path };
	} catch {}

	return null;
}

export async function loadNodePolyfillsPlugin(projectRoot, customPlugin) {
	if (customPlugin !== undefined) {
		if (customPlugin === null) return null;
		return typeof customPlugin === "function" ? customPlugin() : customPlugin;
	}
	const info = findNodePolyfills(projectRoot);
	if (!info) return null;
	try {
		const mod = await import(pathToFileURL(info.path).href);
		const fn = [
			mod.nodePolyfills,
			mod.default?.nodePolyfills,
			mod.default,
		].find((f) => typeof f === "function");
		return fn ? fn() : null;
	} catch {
		return null;
	}
}

async function bundleWithRolldown(
	bundlerInfo,
	{ projectRoot, entryFile, destPath, minify, nodePolyfillsPlugin },
) {
	const rolldownModule =
		bundlerInfo.instance ??
		(await import(pathToFileURL(bundlerInfo.path).href));
	const rolldownFn =
		rolldownModule.rolldown ||
		rolldownModule.default?.rolldown ||
		rolldownModule.default;

	const plugins = [];
	if (nodePolyfillsPlugin) {
		plugins.push(nodePolyfillsPlugin);
	}

	const bundle = await rolldownFn({
		input: entryFile,
		cwd: projectRoot,
		plugins,
	});
	await bundle.write({
		file: destPath,
		format: "esm",
		minify: Boolean(minify),
	});
	await bundle.close();
}

async function bundleWithEsbuild(
	bundlerInfo,
	{ projectRoot, entryFile, destPath, minify },
) {
	const esbuildModule =
		bundlerInfo.instance ??
		(await import(pathToFileURL(bundlerInfo.path).href));
	const buildFn =
		esbuildModule.build || esbuildModule.default?.build || esbuildModule;

	await buildFn({
		entryPoints: [entryFile],
		bundle: true,
		format: "esm",
		outfile: destPath,
		absWorkingDir: projectRoot,
		minify: Boolean(minify),
	});
}

async function runBundler(bundlerInfo, options) {
	if (bundlerInfo.name === "rolldown") {
		await bundleWithRolldown(bundlerInfo, options);
		return;
	}
	if (bundlerInfo.name === "esbuild") {
		await bundleWithEsbuild(bundlerInfo, options);
	}
}

export async function bundleVendor(projectDir = ".", options = {}) {
	const projectRoot = resolve(projectDir);
	const config = loadVendorConfig(projectRoot);

	const packages = options.packages ?? config.packages;
	const dest = options.dest ?? config.dest;
	const minify = options.minify ?? config.minify ?? false;
	const globals = { ...config.globals, ...normalizeGlobals(options.globals) };
	const namedExports = {
		...config.namedExports,
		...normalizeNamedExports(options.namedExports ?? options.exports),
	};

	if (!packages || packages.length === 0) {
		return {
			bundled: [],
			skipped: 0,
			dest,
			minify: Boolean(minify),
			message: "no external dependencies found",
		};
	}

	const destPaths = resolveDestinationPaths(projectRoot, dest);
	const bundlerInfo = options.bundler ?? findBundler(projectRoot);
	const warn = options.logger?.warn ?? console.warn;
	if (!bundlerInfo) {
		warn(
			"gofront: no bundler found (rolldown or esbuild). Run 'npm install --save-dev rolldown' to enable vendor bundling.",
		);
		return {
			bundled: [],
			skipped: packages.length,
			dest,
			bundler: null,
			minify: Boolean(minify),
			reason: "no bundler installed",
		};
	}

	for (const p of destPaths) {
		mkdirSync(dirname(p), { recursive: true });
	}

	const customPlugin =
		options.nodePolyfillsPlugin ??
		bundlerInfo.nodePolyfillsPlugin ??
		(options.nodePolyfills === false ? null : undefined);
	// The polyfill plugin is a Rolldown plugin; esbuild cannot use it.
	const supportsPlugins =
		typeof bundlerInfo.bundle === "function" || bundlerInfo.name === "rolldown";
	const polyfillPlugin = supportsPlugins
		? await loadNodePolyfillsPlugin(projectRoot, customPlugin)
		: null;

	if (typeof bundlerInfo.bundle === "function") {
		try {
			await bundlerInfo.bundle({
				projectRoot,
				packages,
				dest: destPaths.length === 1 ? destPaths[0] : destPaths,
				minify: Boolean(minify),
				nodePolyfillsPlugin: polyfillPlugin,
			});
		} catch (err) {
			if (!polyfillPlugin && isNodeBuiltinError(err.message)) {
				warn(NODE_POLYFILLS_TIP);
			}
			throw err;
		}
		return {
			bundled: packages,
			bundler: bundlerInfo.name ?? "custom",
			dest,
			minify: Boolean(minify),
			nodePolyfills: Boolean(polyfillPlugin),
		};
	}

	const entryCode = generateVendorEntry(packages, globals, namedExports);
	// A fixed name: the bundler records the entry path in vendor.js, so a
	// per-run name would make every prep produce different bytes.
	const entryFile = join(projectRoot, ".gofront-vendor-entry.mjs");
	writeFileSync(entryFile, entryCode);

	try {
		await runBundler(bundlerInfo, {
			projectRoot,
			entryFile,
			destPath: destPaths[0],
			minify,
			nodePolyfillsPlugin: polyfillPlugin,
		});

		for (let i = 1; i < destPaths.length; i++) {
			copyFileSync(destPaths[0], destPaths[i]);
		}
	} catch (err) {
		if (!polyfillPlugin && isNodeBuiltinError(err.message)) {
			warn(NODE_POLYFILLS_TIP);
		}
		throw err;
	} finally {
		if (existsSync(entryFile)) {
			rmSync(entryFile, { force: true });
		}
	}

	return {
		bundled: packages,
		bundler: bundlerInfo.name,
		dest,
		minify: Boolean(minify),
		nodePolyfills: Boolean(polyfillPlugin),
	};
}
