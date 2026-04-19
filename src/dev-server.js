// Minimal dev server for gofront --serve watch mode.
// Serves static files and pushes a reload event via SSE after each build.

import { existsSync, readFileSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join } from "node:path";

const MIME = {
	".html": "text/html; charset=utf-8",
	".js": "application/javascript; charset=utf-8",
	".css": "text/css; charset=utf-8",
	".json": "application/json; charset=utf-8",
	".svg": "image/svg+xml",
	".png": "image/png",
	".jpg": "image/jpeg",
	".ico": "image/x-icon",
	".woff2": "font/woff2",
	".woff": "font/woff",
};

// Injected at the bottom of compiled JS in serve mode.
export const liveReloadClient = `(function(){var es=new EventSource('/_gofront/events');es.addEventListener('reload',function(){location.reload();});})();`;

export function createDevServer(serveDir, port) {
	const clients = new Set();

	const server = createServer((req, res) => {
		// SSE endpoint — browser connects here to receive reload events
		if (req.url === "/_gofront/events") {
			res.writeHead(200, {
				"Content-Type": "text/event-stream",
				"Cache-Control": "no-cache",
				Connection: "keep-alive",
			});
			res.write(": connected\n\n");
			clients.add(res);
			req.on("close", () => clients.delete(res));
			return;
		}

		let urlPath = req.url.split("?")[0];
		if (urlPath === "/" || urlPath === "") urlPath = "/index.html";

		const filePath = join(serveDir, urlPath);
		if (!existsSync(filePath)) {
			res.writeHead(404, { "Content-Type": "text/plain" });
			res.end("Not found");
			return;
		}

		try {
			const data = readFileSync(filePath);
			const mime = MIME[extname(filePath)] ?? "application/octet-stream";
			res.writeHead(200, { "Content-Type": mime });
			res.end(data);
		} catch {
			res.writeHead(500, { "Content-Type": "text/plain" });
			res.end("Server error");
		}
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
		console.error(`gofront: dev server → http://localhost:${port}`);
	});

	function notify() {
		for (const client of clients) {
			client.write("event: reload\ndata: {}\n\n");
		}
	}

	return { notify };
}
