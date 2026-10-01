// Minimal dev server for gofront --serve watch mode.
// Serves static files and pushes reload / error / css-update events via SSE.

import { existsSync, readFileSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { colors, log } from "./colors.js";

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

// Injected at the bottom of served HTML before </body> in serve mode.
export const liveReloadClient = `(function() {
	var retryDelay = 1000;
	var maxDelay = 16000;
	var es = null;
	var overlayId = 'gofront-error-overlay';

	function dismissErrorOverlay() {
		var overlay = document.getElementById(overlayId);
		if (overlay) overlay.remove();
	}

	function showErrorOverlay(data) {
		var msg = typeof data === 'string' ? data : (data && data.message ? data.message : JSON.stringify(data, null, 2));
		var overlay = document.getElementById(overlayId);
		if (!overlay) {
			overlay = document.createElement('div');
			overlay.id = overlayId;
			overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;width:100%;height:100%;background:rgba(15,23,42,0.85);backdrop-filter:blur(4px);z-index:999999;display:flex;align-items:center;justify-content:center;padding:24px;box-sizing:border-box;font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace;';
			(document.body || document.documentElement).appendChild(overlay);
		}
		overlay.innerHTML = '<div style="background:#18181b;color:#f43f5e;border:1px solid #e11d48;border-radius:8px;max-width:850px;width:100%;max-height:90vh;display:flex;flex-direction:column;box-shadow:0 25px 50px -12px rgba(0,0,0,0.7);overflow:hidden;box-sizing:border-box;">'
			+ '<div style="display:flex;justify-content:space-between;align-items:center;padding:14px 20px;border-bottom:1px solid #27272a;background:#27272a;">'
			+ '<div style="font-weight:600;font-size:14px;color:#fda4af;display:flex;align-items:center;gap:8px;">'
			+ '<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:#f43f5e;"></span>'
			+ 'GoFront Compilation Error</div>'
			+ '<button id="gofront-close-overlay" style="background:transparent;border:none;color:#a1a1aa;cursor:pointer;font-size:18px;line-height:1;padding:4px 8px;border-radius:4px;">✕</button>'
			+ '</div>'
			+ '<div style="padding:20px;overflow:auto;">'
			+ '<pre style="margin:0;white-space:pre-wrap;word-break:break-word;font-size:13px;line-height:1.6;color:#fecdd3;background:#09090b;padding:16px;border-radius:6px;border:1px solid #27272a;font-family:inherit;"></pre>'
			+ '</div>'
			+ '</div>';
		var closeBtn = overlay.querySelector('#gofront-close-overlay');
		if (closeBtn) closeBtn.onclick = dismissErrorOverlay;
		var pre = overlay.querySelector('pre');
		if (pre) pre.textContent = msg;
	}

	function updateCss(file) {
		var links = document.querySelectorAll('link[rel="stylesheet"]');
		var fileName = file ? file.split(/[\\\\/]/).pop() : null;
		var anyMatched = false;
		for (var i = 0; i < links.length; i++) {
			var link = links[i];
			var rawHref = link.getAttribute('href');
			if (!rawHref) continue;
			if (fileName) {
				var cleanHref = rawHref.split('?')[0].split('#')[0];
				var base = cleanHref.split(/[\\\\/]/).pop();
				if (base !== fileName) continue;
			}
			anyMatched = true;
			var url = new URL(link.href, window.location.href);
			url.searchParams.set('t', Date.now().toString());
			link.href = url.toString();
		}
		if (!anyMatched && !fileName) {
			for (var j = 0; j < links.length; j++) {
				var l = links[j];
				var u = new URL(l.href, window.location.href);
				u.searchParams.set('t', Date.now().toString());
				l.href = u.toString();
			}
		}
	}

	function handleBuildError(e) {
		try {
			showErrorOverlay(JSON.parse(e.data));
		} catch (_) {
			showErrorOverlay(e.data);
		}
	}

	function connect() {
		if (es) {
			try { es.close(); } catch (_) {}
		}
		es = new EventSource('/_gofront/events');
		es.onopen = function() {
			retryDelay = 1000;
		};
		es.onerror = function() {
			es.close();
			setTimeout(function() {
				retryDelay = Math.min(retryDelay * 2, maxDelay);
				connect();
			}, retryDelay);
		};
		es.addEventListener('reload', function() {
			dismissErrorOverlay();
			location.reload();
		});
		es.addEventListener('build-error', handleBuildError);
		es.addEventListener('css-update', function(e) {
			try {
				var data = JSON.parse(e.data);
				updateCss(data.file);
			} catch (_) {
				updateCss();
			}
		});
	}

	connect();
})();`;

export function injectLiveReload(html) {
	const script = `<script id="gofront-live-reload">${liveReloadClient}</script>`;
	if (/<\/body>/i.test(html)) {
		return html.replace(/<\/body>/i, () => `${script}</body>`);
	}
	return `${html}${script}`;
}

// True when `target` is `root` itself or a path inside it (no `..` escape).
function isInsideDir(root, target) {
	const rel = relative(root, target);
	return rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}

function handleSseRequest(req, res, clients, lastError = null) {
	res.writeHead(200, {
		"Content-Type": "text/event-stream",
		"Cache-Control": "no-cache",
		Connection: "keep-alive",
	});
	res.write(": connected\n\n");
	if (lastError)
		res.write(`event: build-error\ndata: ${JSON.stringify(lastError)}\n\n`);
	clients.add(res);
	req.on?.("close", () => clients.delete(res));
}

function resolveStaticPath(serveDir, urlPath) {
	const cleanPath =
		urlPath === "/" || urlPath === ""
			? "/index.html"
			: urlPath.startsWith("/")
				? urlPath
				: `/${urlPath}`;
	const filePath = resolve(serveDir, `.${cleanPath}`);
	if (!isInsideDir(resolve(serveDir), filePath)) return { forbidden: true };

	if (existsSync(filePath)) {
		const stat = statSync(filePath);
		if (stat.isDirectory()) {
			const dirIndex = join(filePath, "index.html");
			if (existsSync(dirIndex)) return { filePath: dirIndex };
			const rootIndex = join(serveDir, "index.html");
			if (existsSync(rootIndex)) return { filePath: rootIndex };
			return { notFound: true };
		}
		return { filePath };
	}

	// SPA fallback: clean paths with no file extension fall back to index.html
	if (!extname(cleanPath)) {
		const indexPath = join(serveDir, "index.html");
		if (existsSync(indexPath)) return { filePath: indexPath };
	}

	return { notFound: true };
}

function sendStaticFile(res, filePath, shouldInject) {
	try {
		const ext = extname(filePath);
		if (ext === ".html") {
			const data = readFileSync(filePath, "utf8");
			const body = shouldInject ? injectLiveReload(data) : data;
			res.writeHead(200, {
				"Content-Type": MIME[".html"],
				"Cache-Control": "no-cache, no-store, must-revalidate",
			});
			res.end(body);
			return;
		}

		const data = readFileSync(filePath);
		res.writeHead(200, {
			"Content-Type": MIME[ext] ?? "application/octet-stream",
			"Cache-Control": "no-cache, no-store, must-revalidate",
		});
		res.end(data);
	} catch {
		res.writeHead(500, { "Content-Type": "text/plain" });
		res.end("Server error");
	}
}

export function handleDevRequest(
	req,
	res,
	serveDir,
	clients = new Set(),
	options = {},
) {
	if (req.url === "/_gofront/events") {
		handleSseRequest(req, res, clients, options.getLastError?.() ?? null);
		return;
	}

	let urlPath = req.url.split("?")[0].split("#")[0];
	try {
		urlPath = decodeURIComponent(urlPath);
	} catch {}

	const resolved = resolveStaticPath(serveDir, urlPath);
	if (resolved.forbidden) {
		res.writeHead(403, { "Content-Type": "text/plain" });
		res.end("Forbidden");
		return;
	}
	if (resolved.notFound) {
		res.writeHead(404, { "Content-Type": "text/plain" });
		res.end("Not found");
		return;
	}

	sendStaticFile(res, resolved.filePath, options.injectReload ?? true);
}

function broadcastToClients(clients, event, payload) {
	const body = typeof payload === "string" ? payload : JSON.stringify(payload);
	for (const client of clients) {
		try {
			client.write(`event: ${event}\ndata: ${body}\n\n`);
		} catch {
			clients.delete(client);
		}
	}
}

function sendPings(clients) {
	for (const client of clients) {
		try {
			client.write(": ping\n\n");
		} catch {
			clients.delete(client);
		}
	}
}

function createNotify(clients) {
	return function notify(arg) {
		if (arg?.type) {
			broadcastToClients(clients, arg.type, arg);
			return;
		}
		broadcastToClients(clients, "reload", {});
	};
}

function handleServerError(err, port) {
	if (err.code === "EADDRINUSE") {
		log.fail(`port ${port} already in use — try --port <number>`);
	} else {
		log.fail(`dev server error: ${err.message}`);
	}
	process.exit(1);
}

function buildErrorPayload(err) {
	let message = "";
	let loc = null;
	if (typeof err === "string") {
		message = err;
	} else if (err) {
		message = err.message || String(err);
		if (err.loc) {
			loc = err.loc;
		} else if (err.line !== undefined || err.file !== undefined) {
			loc = { line: err.line, col: err.column ?? err.col, file: err.file };
		}
	}
	const payload = { type: "build-error", message };
	if (loc) payload.loc = loc;
	return payload;
}

function closeServer(server, clients, timer) {
	if (timer) clearInterval(timer);
	for (const client of clients) {
		try {
			client.end();
		} catch {}
	}
	clients.clear();
	return new Promise((res) => server.close(res));
}

export function createDevServer(serveDir, port = 3000, options = {}) {
	const clients = new Set();
	const heartbeatMs = options.heartbeatInterval ?? 15000;
	const host = options.host ?? "localhost";
	// Kept so browsers that connect (or reload) after a failed build still see the overlay.
	let lastError = null;
	const requestOptions = { ...options, getLastError: () => lastError };

	const server = createServer((req, res) => {
		handleDevRequest(req, res, serveDir, clients, requestOptions);
	});

	server.on("error", (err) => handleServerError(err, port));
	server.listen(port, host, () => {
		const actualPort = server.address()?.port ?? port;
		if (port !== 0 && !options.silent) {
			log.info(`dev server → ${colors.cyan(`http://localhost:${actualPort}`)}`);
		}
	});

	const heartbeatTimer =
		heartbeatMs > 0 ? setInterval(() => sendPings(clients), heartbeatMs) : null;
	heartbeatTimer?.unref?.();

	const broadcastNotify = createNotify(clients);
	const notify = (arg) => {
		if (!arg?.type) lastError = null;
		broadcastNotify(arg);
	};
	const notifyError = (err) => {
		lastError = buildErrorPayload(err);
		broadcastToClients(clients, "build-error", lastError);
	};

	return {
		broadcast: (event, data) => broadcastToClients(clients, event, data),
		notify,
		notifyCss: (file) =>
			broadcastToClients(clients, "css-update", { type: "css-update", file }),
		notifyError,
		notifyBuildError: notifyError,
		ping: () => sendPings(clients),
		clients,
		server,
		close: () => closeServer(server, clients, heartbeatTimer),
	};
}
