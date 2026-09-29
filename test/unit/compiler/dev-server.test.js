// GoFront test suite — dev server & SPA route fallback
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
	createDevServer,
	handleDevRequest,
	injectLiveReload,
	liveReloadClient,
	MIME,
} from "../../../src/dev-server.js";
import {
	assert,
	assertContains,
	assertEqual,
	section,
	summarize,
	test,
} from "../helpers.js";

section("dev-server — static files & MIME types");

function createMockRes() {
	let statusCode = 200;
	let headers = {};
	let body = null;
	return {
		writeHead(code, h) {
			statusCode = code;
			headers = { ...headers, ...h };
			return this;
		},
		write(data) {
			body = (body ?? "") + data;
			return true;
		},
		end(data) {
			if (data !== undefined) {
				body = data;
			}
		},
		get statusCode() {
			return statusCode;
		},
		get headers() {
			return headers;
		},
		get body() {
			return body;
		},
	};
}

test("serves index.html on root / request with injected live reload script", () => {
	const dir = mkdtempSync(join(tmpdir(), "gofront-dev-"));
	try {
		writeFileSync(join(dir, "index.html"), "<h1>Home</h1>");
		const req = { url: "/" };
		const res = createMockRes();
		handleDevRequest(req, res, dir);

		assertEqual(res.statusCode, 200);
		assertEqual(res.headers["Content-Type"], MIME[".html"]);
		assertEqual(
			res.headers["Cache-Control"],
			"no-cache, no-store, must-revalidate",
		);
		assertContains(res.body.toString("utf8"), "<h1>Home</h1>");
		assertContains(res.body.toString("utf8"), "gofront-live-reload");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("serves static JS and CSS with correct MIME types without injection", () => {
	const dir = mkdtempSync(join(tmpdir(), "gofront-dev-mime-"));
	try {
		writeFileSync(join(dir, "app.js"), "console.log('hi');");
		writeFileSync(join(dir, "style.css"), "body { color: red; }");

		const jsRes = createMockRes();
		handleDevRequest({ url: "/app.js" }, jsRes, dir);
		assertEqual(jsRes.statusCode, 200);
		assertEqual(jsRes.headers["Content-Type"], MIME[".js"]);
		assertEqual(
			jsRes.headers["Cache-Control"],
			"no-cache, no-store, must-revalidate",
		);
		assertEqual(jsRes.body.toString("utf8"), "console.log('hi');");
		assert(
			!jsRes.body.toString("utf8").includes("gofront-live-reload"),
			"expected compiled JS to not contain injected reload script",
		);

		const cssRes = createMockRes();
		handleDevRequest({ url: "/style.css" }, cssRes, dir);
		assertEqual(cssRes.statusCode, 200);
		assertEqual(cssRes.headers["Content-Type"], MIME[".css"]);
		assertEqual(
			cssRes.headers["Cache-Control"],
			"no-cache, no-store, must-revalidate",
		);
		assertEqual(cssRes.body.toString("utf8"), "body { color: red; }");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("serves static files when requested without leading slash", () => {
	const dir = mkdtempSync(join(tmpdir(), "gofront-dev-noslash-"));
	try {
		writeFileSync(join(dir, "app.js"), "console.log('noslash');");
		const jsRes = createMockRes();
		handleDevRequest({ url: "app.js" }, jsRes, dir);
		assertEqual(jsRes.statusCode, 200);
		assertEqual(jsRes.headers["Content-Type"], MIME[".js"]);
		assertEqual(jsRes.body.toString("utf8"), "console.log('noslash');");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

section("dev-server — HTML SSE script injection");

test("injectLiveReload injects script before </body> when present", () => {
	const html = "<!DOCTYPE html><html><body><h1>Hello</h1></body></html>";
	const injected = injectLiveReload(html);
	assertContains(injected, '<script id="gofront-live-reload">');
	assert(
		injected.endsWith("</script></body></html>"),
		`expected script before </body>, got: ${injected}`,
	);
});

test("injectLiveReload appends script when </body> is missing", () => {
	const html = "<h1>Fragment</h1>";
	const injected = injectLiveReload(html);
	assertEqual(
		injected,
		`<h1>Fragment</h1><script id="gofront-live-reload">${liveReloadClient}</script>`,
	);
});

section("dev-server — SPA fallback");

test("SPA fallback: serves index.html for clean URLs without file extension", () => {
	const dir = mkdtempSync(join(tmpdir(), "gofront-dev-spa-"));
	try {
		const htmlContent = "<html><body>SPA App</body></html>";
		writeFileSync(join(dir, "index.html"), htmlContent);

		for (const route of ["/blog", "/projects", "/about", "/user/123"]) {
			const res = createMockRes();
			handleDevRequest({ url: route }, res, dir);
			assertEqual(res.statusCode, 200);
			assertEqual(res.headers["Content-Type"], MIME[".html"]);
			assertContains(res.body.toString("utf8"), "SPA App");
			assertContains(res.body.toString("utf8"), "gofront-live-reload");
		}
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("SPA fallback: strips query strings and hash before matching", () => {
	const dir = mkdtempSync(join(tmpdir(), "gofront-dev-query-"));
	try {
		const htmlContent = "<html><body>Query SPA</body></html>";
		writeFileSync(join(dir, "index.html"), htmlContent);

		const res = createMockRes();
		handleDevRequest({ url: "/blog?page=2&tag=gofront#section" }, res, dir);
		assertEqual(res.statusCode, 200);
		assertEqual(res.headers["Content-Type"], MIME[".html"]);
		assertContains(res.body.toString("utf8"), "Query SPA");
		assertContains(res.body.toString("utf8"), "gofront-live-reload");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("returns 404 for missing static asset with extension", () => {
	const dir = mkdtempSync(join(tmpdir(), "gofront-dev-404-"));
	try {
		writeFileSync(join(dir, "index.html"), "<html><body>App</body></html>");

		for (const missing of [
			"/bundle.js",
			"/theme.css",
			"/logo.png",
			"/font.woff2",
		]) {
			const res = createMockRes();
			handleDevRequest({ url: missing }, res, dir);
			assertEqual(res.statusCode, 404);
			assertEqual(res.body, "Not found");
		}
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("returns 404 when index.html is missing on clean URL", () => {
	const dir = mkdtempSync(join(tmpdir(), "gofront-dev-noindex-"));
	try {
		const res = createMockRes();
		handleDevRequest({ url: "/blog" }, res, dir);
		assertEqual(res.statusCode, 404);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("prevents directory traversal outside serve directory", () => {
	const dir = mkdtempSync(join(tmpdir(), "gofront-dev-trav-"));
	try {
		const res = createMockRes();
		handleDevRequest({ url: "/../../package.json" }, res, dir);
		assertEqual(res.statusCode, 403);
		assertEqual(res.body, "Forbidden");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("blocks traversal into a sibling directory sharing the serve dir prefix", () => {
	const root = mkdtempSync(join(tmpdir(), "gofront-dev-sib-"));
	try {
		const serveDir = join(root, "app");
		const sibling = join(root, "app-secret");
		mkdirSync(serveDir);
		mkdirSync(sibling);
		writeFileSync(join(serveDir, "index.html"), "ok");
		writeFileSync(join(sibling, "secret.txt"), "LEAKED");

		const res = createMockRes();
		handleDevRequest({ url: "/../app-secret/secret.txt" }, res, serveDir);
		assertEqual(res.statusCode, 403);
		assertEqual(res.body, "Forbidden");

		const encoded = createMockRes();
		handleDevRequest(
			{ url: "/%2e%2e/app-secret/secret.txt" },
			encoded,
			serveDir,
		);
		assertEqual(encoded.statusCode, 403);

		const okRes = createMockRes();
		handleDevRequest({ url: "/" }, okRes, serveDir);
		assertEqual(okRes.statusCode, 200);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("serves files whose name starts with '..' inside the serve dir", () => {
	const dir = mkdtempSync(join(tmpdir(), "gofront-dev-dotdot-"));
	try {
		mkdirSync(join(dir, "..cache"));
		writeFileSync(join(dir, "..cache", "x.js"), "1");
		writeFileSync(join(dir, "..hidden.js"), "2");

		const nested = createMockRes();
		handleDevRequest({ url: "/..cache/x.js" }, nested, dir);
		assertEqual(nested.statusCode, 200);
		assertEqual(nested.body.toString("utf8"), "1");

		const flat = createMockRes();
		handleDevRequest({ url: "/..hidden.js" }, flat, dir);
		assertEqual(flat.statusCode, 200);
		assertEqual(flat.body.toString("utf8"), "2");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("serves nested directory index.html if present, else root index.html", () => {
	const dir = mkdtempSync(join(tmpdir(), "gofront-dev-dir-"));
	try {
		writeFileSync(join(dir, "index.html"), "root index");
		const subDir = join(dir, "docs");
		mkdirSync(subDir, { recursive: true });
		writeFileSync(join(subDir, "index.html"), "docs index");

		const docsRes = createMockRes();
		handleDevRequest({ url: "/docs" }, docsRes, dir);
		assertEqual(docsRes.statusCode, 200);
		assertContains(docsRes.body.toString("utf8"), "docs index");
		assertContains(docsRes.body.toString("utf8"), "gofront-live-reload");

		const emptySubDir = join(dir, "empty");
		mkdirSync(emptySubDir, { recursive: true });
		const emptyRes = createMockRes();
		handleDevRequest({ url: "/empty" }, emptyRes, dir);
		assertEqual(emptyRes.statusCode, 200);
		assertContains(emptyRes.body.toString("utf8"), "root index");
		assertContains(emptyRes.body.toString("utf8"), "gofront-live-reload");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

section("dev-server — SSE & lifecycle");

test("SSE endpoint connects and notifies clients", () => {
	const clients = new Set();
	const res = createMockRes();
	const req = {
		url: "/_gofront/events",
		on: (evt, _cb) => {
			if (evt === "close") {
				// registered
			}
		},
	};

	handleDevRequest(req, res, tmpdir(), clients);
	assertEqual(res.statusCode, 200);
	assertEqual(res.headers["Content-Type"], "text/event-stream");
	assertEqual(clients.size, 1);
	assertContains(liveReloadClient, "EventSource");
});

test("SSE keep-alive sends ping comment frames", () => {
	const dir = mkdtempSync(join(tmpdir(), "gofront-dev-ping-"));
	try {
		const dev = createDevServer(dir, 0);
		const client = createMockRes();
		dev.clients.add(client);

		dev.ping();
		assertContains(client.body, ": ping\n\n");
		dev.close();
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("SSE heartbeat interval emits ping comment frames automatically", async () => {
	const dir = mkdtempSync(join(tmpdir(), "gofront-dev-hb-"));
	try {
		const dev = createDevServer(dir, 0, { heartbeatInterval: 20 });
		const client = createMockRes();
		dev.clients.add(client);

		await new Promise((resolve) => setTimeout(resolve, 50));
		assertContains(client.body, ": ping\n\n");
		await dev.close();
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("dev server broadcasts build-error event on compilation error", () => {
	const dir = mkdtempSync(join(tmpdir(), "gofront-dev-err-"));
	try {
		const dev = createDevServer(dir, 0);
		const client = createMockRes();
		dev.clients.add(client);

		dev.notifyError(new Error("syntax error on line 42"));
		assertContains(client.body, "event: build-error\n");
		assertContains(client.body, "syntax error on line 42");
		dev.close();
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("dev server broadcasts css-update event on CSS changes", () => {
	const dir = mkdtempSync(join(tmpdir(), "gofront-dev-css-"));
	try {
		const dev = createDevServer(dir, 0);
		const client = createMockRes();
		dev.clients.add(client);

		dev.notifyCss("styles.css");
		assertContains(client.body, "event: css-update\n");
		assertContains(client.body, "styles.css");
		dev.close();
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("liveReloadClient contains error overlay, reconnect backoff, and CSS updater", () => {
	assertContains(liveReloadClient, "gofront-error-overlay");
	assertContains(liveReloadClient, "retryDelay");
	assertContains(liveReloadClient, "css-update");
	assertContains(liveReloadClient, "build-error");
	assertContains(liveReloadClient, "location.reload()");
});

test("createDevServer starts and closes cleanly", () => {
	const dir = mkdtempSync(join(tmpdir(), "gofront-dev-srv-"));
	try {
		writeFileSync(join(dir, "index.html"), "<h1>Dev Server</h1>");
		const dev = createDevServer(dir, 0);
		assert(dev.server !== undefined, "expected server instance");
		assert(typeof dev.notify === "function", "expected notify function");
		assert(
			typeof dev.notifyError === "function",
			"expected notifyError function",
		);
		assert(typeof dev.notifyCss === "function", "expected notifyCss function");
		assert(typeof dev.ping === "function", "expected ping function");
		assert(typeof dev.close === "function", "expected close function");
		dev.close();
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	process.exit((await summarize()) > 0 ? 1 : 0);
}
