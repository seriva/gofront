// GoFront test suite — dev server & SPA route fallback
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
	createDevServer,
	handleDevRequest,
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

test("serves index.html on root / request", () => {
	const dir = mkdtempSync(join(tmpdir(), "gofront-dev-"));
	try {
		writeFileSync(join(dir, "index.html"), "<h1>Home</h1>");
		const req = { url: "/" };
		const res = createMockRes();
		handleDevRequest(req, res, dir);

		assertEqual(res.statusCode, 200);
		assertEqual(res.headers["Content-Type"], MIME[".html"]);
		assertEqual(res.body.toString("utf8"), "<h1>Home</h1>");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("serves static JS and CSS with correct MIME types", () => {
	const dir = mkdtempSync(join(tmpdir(), "gofront-dev-mime-"));
	try {
		writeFileSync(join(dir, "app.js"), "console.log('hi');");
		writeFileSync(join(dir, "style.css"), "body { color: red; }");

		const jsRes = createMockRes();
		handleDevRequest({ url: "/app.js" }, jsRes, dir);
		assertEqual(jsRes.statusCode, 200);
		assertEqual(jsRes.headers["Content-Type"], MIME[".js"]);
		assertEqual(jsRes.body.toString("utf8"), "console.log('hi');");

		const cssRes = createMockRes();
		handleDevRequest({ url: "/style.css" }, cssRes, dir);
		assertEqual(cssRes.statusCode, 200);
		assertEqual(cssRes.headers["Content-Type"], MIME[".css"]);
		assertEqual(cssRes.body.toString("utf8"), "body { color: red; }");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
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
			assertEqual(res.body.toString("utf8"), htmlContent);
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
		assertEqual(res.body.toString("utf8"), htmlContent);
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
		assertEqual(docsRes.body.toString("utf8"), "docs index");

		const emptySubDir = join(dir, "empty");
		mkdirSync(emptySubDir, { recursive: true });
		const emptyRes = createMockRes();
		handleDevRequest({ url: "/empty" }, emptyRes, dir);
		assertEqual(emptyRes.statusCode, 200);
		assertEqual(emptyRes.body.toString("utf8"), "root index");
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

test("createDevServer starts and closes cleanly", () => {
	const dir = mkdtempSync(join(tmpdir(), "gofront-dev-srv-"));
	try {
		writeFileSync(join(dir, "index.html"), "<h1>Dev Server</h1>");
		const dev = createDevServer(dir, 0);
		assert(dev.server !== undefined, "expected server instance");
		assert(typeof dev.notify === "function", "expected notify function");
		assert(typeof dev.close === "function", "expected close function");
		dev.close();
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	process.exit(summarize() > 0 ? 1 : 0);
}
