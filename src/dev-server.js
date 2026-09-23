// Minimal dev server for gofront --serve watch mode.
// Serves static files and pushes a reload event via SSE after each build.

import { existsSync, readFileSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, isAbsolute, join, relative, resolve, sep } from "node:path";

export const MIME = {
	".html": "text/html; charset=utf-8",
	".js": "application/javascript; charset=utf-8",
	".css": "text/css; charset=utf-8",
	".json": "application/json; charset=utf-8",
	".go": "text/plain; charset=utf-8",
	".svg": "image/svg+xml",
	".png": "image/png",
	".jpg": "image/jpeg",
	".ico": "image/x-icon",
	".woff2": "font/woff2",
	".woff": "font/woff",
};

// Injected at the bottom of compiled JS in serve mode.
export const liveReloadClient = `(function(){var es=new EventSource('/_gofront/events');es.addEventListener('reload',function(){location.reload();});})();`;

// True when `target` is `root` itself or a path inside it (no `..` escape).
function isInsideDir(root, target) {
	const rel = relative(root, target);
	return rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}

export function handleDevRequest(req, res, serveDir, clients = new Set()) {
	// SSE endpoint — browser connects here to receive reload events
	if (req.url === "/_gofront/events") {
		res.writeHead(200, {
			"Content-Type": "text/event-stream",
			"Cache-Control": "no-cache",
			Connection: "keep-alive",
		});
		res.write(": connected\n\n");
		clients.add(res);
		req.on?.("close", () => clients.delete(res));
		return;
	}

	let urlPath = req.url.split("?")[0].split("#")[0];
	try {
		urlPath = decodeURIComponent(urlPath);
	} catch {
		// Ignore malformed URL encoding and use raw path
	}

	if (urlPath === "/" || urlPath === "") urlPath = "/index.html";

	const filePath = resolve(serveDir, `.${urlPath}`);
	if (!isInsideDir(resolve(serveDir), filePath)) {
		res.writeHead(403, { "Content-Type": "text/plain" });
		res.end("Forbidden");
		return;
	}

	if (!existsSync(filePath)) {
		// SPA fallback: clean paths with no file extension fall back to index.html
		const ext = extname(urlPath);
		if (!ext) {
			const indexPath = join(serveDir, "index.html");
			if (existsSync(indexPath)) {
				try {
					const data = readFileSync(indexPath);
					res.writeHead(200, { "Content-Type": MIME[".html"] });
					res.end(data);
					return;
				} catch {
					res.writeHead(500, { "Content-Type": "text/plain" });
					res.end("Server error");
					return;
				}
			}
		}
		res.writeHead(404, { "Content-Type": "text/plain" });
		res.end("Not found");
		return;
	}

	try {
		const stat = statSync(filePath);
		if (stat.isDirectory()) {
			const dirIndex = join(filePath, "index.html");
			if (existsSync(dirIndex)) {
				const data = readFileSync(dirIndex);
				res.writeHead(200, { "Content-Type": MIME[".html"] });
				res.end(data);
				return;
			}
			const rootIndex = join(serveDir, "index.html");
			if (existsSync(rootIndex)) {
				const data = readFileSync(rootIndex);
				res.writeHead(200, { "Content-Type": MIME[".html"] });
				res.end(data);
				return;
			}
			res.writeHead(404, { "Content-Type": "text/plain" });
			res.end("Not found");
			return;
		}

		const data = readFileSync(filePath);
		const mime = MIME[extname(filePath)] ?? "application/octet-stream";
		res.writeHead(200, { "Content-Type": mime });
		res.end(data);
	} catch {
		res.writeHead(500, { "Content-Type": "text/plain" });
		res.end("Server error");
	}
}

export function createDevServer(serveDir, port = 3000) {
	const clients = new Set();

	const server = createServer((req, res) => {
		handleDevRequest(req, res, serveDir, clients);
	});

	server.on("error", (err) => {
		if (err.code === "EADDRINUSE") {
			console.error(
				`gofront: port ${port} already in use — try --port <number>`,
			);
		} else {
			console.error(`gofront: dev server error: ${err.message}`);
		}
		process.exit(1);
	});

	server.listen(port, () => {
		const actualPort = server.address()?.port ?? port;
		if (port !== 0) {
			console.error(`gofront: dev server → http://localhost:${actualPort}`);
		}
	});

	function notify() {
		for (const client of clients) {
			client.write("event: reload\ndata: {}\n\n");
		}
	}

	return {
		notify,
		server,
		close: () => new Promise((res) => server.close(res)),
	};
}
