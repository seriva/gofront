import {
	existsSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { handleBuild } from "../../../src/cli-core.js";
import {
	collectPwaAssets,
	generatePwa,
	generateServiceWorkerSource,
	injectPwaRegistration,
	PWA_REGISTER_SNIPPET,
} from "../../../src/pwa.js";
import {
	assert,
	assertContains,
	assertEqual,
	section,
	summarize,
	test,
} from "../helpers.js";

section("pwa — asset collection");

test("PWA_REGISTER_SNIPPET contains serviceWorker registration", () => {
	assertContains(PWA_REGISTER_SNIPPET, "navigator.serviceWorker.register");
});

test("collectPwaAssets collects files and ignores sw.js and .map files", () => {
	const dir = mkdtempSync(join(tmpdir(), "gofront-pwa-assets-"));
	try {
		writeFileSync(join(dir, "index.html"), "<h1>Home</h1>");
		writeFileSync(join(dir, "app.js"), "console.log('hi');");
		writeFileSync(join(dir, "app.js.map"), "{}");
		writeFileSync(join(dir, "sw.js"), "// existing sw");

		const assets = collectPwaAssets(dir);
		assertContains(assets, "./index.html");
		assertContains(assets, "./app.js");
		assertContains(assets, "./");
		assert(!assets.includes("./sw.js"), "expected sw.js to be excluded");
		assert(!assets.includes("./app.js.map"), "expected .map to be excluded");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

section("pwa — service worker generation");

test("generateServiceWorkerSource creates valid SW script", () => {
	const assets = ["./", "./index.html", "./app.js"];
	const src = generateServiceWorkerSource(assets, "v1.2.3");

	assertContains(src, 'const CACHE_NAME = "gofront-v1.2.3";');
	assertContains(src, '"./index.html"');
	assertContains(src, 'self.addEventListener("install"');
	assertContains(src, 'self.addEventListener("activate"');
	assertContains(src, 'self.addEventListener("fetch"');
	assertContains(src, "caches.open(CACHE_NAME)");
	assertContains(src, "self.skipWaiting()");
	assertContains(src, "self.clients.claim()");
});

section("pwa — registration injection");

test("injectPwaRegistration injects script before </body>", () => {
	const html = "<!DOCTYPE html><html><body><h1>App</h1></body></html>";
	const injected = injectPwaRegistration(html);

	assertContains(injected, 'id="gofront-pwa"');
	assertContains(injected, "navigator.serviceWorker.register('./sw.js')");
	assert(injected.includes("</body>"), "expected </body> to remain present");
});

test("injectPwaRegistration does not duplicate if already present", () => {
	const html = `<html><body><script id="gofront-pwa"></script></body></html>`;
	const injected = injectPwaRegistration(html);
	assertEqual(injected, html);
});

test("injectPwaRegistration appends to end if </body> missing", () => {
	const html = "<div>Fragment</div>";
	const injected = injectPwaRegistration(html);
	assertContains(injected, "<div>Fragment</div>");
	assertContains(injected, 'id="gofront-pwa"');
});

section("pwa — generatePwa integration");

test("generatePwa emits sw.js and injects into index.html", () => {
	const dir = mkdtempSync(join(tmpdir(), "gofront-pwa-gen-"));
	try {
		writeFileSync(join(dir, "index.html"), "<html><body>Hello</body></html>");
		writeFileSync(join(dir, "app.js"), "console.log('hi');");

		const result = generatePwa(dir, { version: "test-v1" });
		assertEqual(result.version, "test-v1");
		assert(result.assetsCount >= 2, "expected at least 2 assets cached");
		assert(existsSync(result.swPath), "expected sw.js to exist");

		const swContent = readFileSync(result.swPath, "utf8");
		assertContains(swContent, "gofront-test-v1");

		const html = readFileSync(join(dir, "index.html"), "utf8");
		assertContains(html, 'id="gofront-pwa"');
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("handleBuild with pwa option generates sw.js in release output", async () => {
	const dir = mkdtempSync(join(tmpdir(), "gofront-pwa-build-"));
	const outDir = join(dir, "dist");
	try {
		writeFileSync(
			join(dir, "main.go"),
			`package main\nfunc main() { console.log("pwa build") }\n`,
		);
		writeFileSync(join(dir, "index.html"), "<html><body>Home</body></html>");

		const result = await handleBuild(dir, {
			outDir,
			pwa: true,
		});

		assert(result.pwa !== null, "expected pwa result on handleBuild");
		assertEqual(typeof result.pwa.assetsCount, "number");
		assert(
			existsSync(join(outDir, "sw.js")),
			"expected sw.js to exist in outDir",
		);

		const html = readFileSync(join(outDir, "index.html"), "utf8");
		assertContains(html, 'id="gofront-pwa"');
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	process.exit((await summarize()) > 0 ? 1 : 0);
}
