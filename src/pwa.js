// Offline PWA & Service Worker Generation for GoFront.
// Implements zero-configuration pre-caching and service worker emission.

import {
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";

export const PWA_REGISTER_SNIPPET = `<script id="gofront-pwa">
if ('serviceWorker' in navigator) {
	window.addEventListener('load', () => {
		navigator.serviceWorker.register('./sw.js').catch(() => {});
	});
}
</script>`;

export function collectPwaAssets(outDir) {
	const assets = [];
	function walk(dir, prefix = "") {
		for (const entry of readdirSync(dir, { withFileTypes: true })) {
			const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
			const full = join(dir, entry.name);
			if (entry.isDirectory()) {
				walk(full, rel);
			} else if (entry.isFile()) {
				if (entry.name !== "sw.js" && !entry.name.endsWith(".map")) {
					assets.push(`./${rel}`);
				}
			}
		}
	}
	if (existsSync(outDir)) {
		walk(outDir);
	}
	if (assets.includes("./index.html") && !assets.includes("./")) {
		assets.unshift("./");
	}
	return assets.sort();
}

export function generateServiceWorkerSource(assets, version) {
	const assetList = JSON.stringify(assets, null, 2);
	return `// GoFront PWA Service Worker — offline cache
const CACHE_NAME = "gofront-${version}";
const ASSETS = ${assetList};

self.addEventListener("install", (event) => {
	event.waitUntil(
		caches.open(CACHE_NAME).then((cache) => {
			return cache.addAll(ASSETS);
		}).then(() => self.skipWaiting()),
	);
});

self.addEventListener("activate", (event) => {
	event.waitUntil(
		caches.keys().then((keys) => {
			return Promise.all(
				keys.map((key) => {
					if (key !== CACHE_NAME && key.startsWith("gofront-")) {
						return caches.delete(key);
					}
				}),
			);
		}).then(() => self.clients.claim()),
	);
});

self.addEventListener("fetch", (event) => {
	if (event.request.method !== "GET") return;
	event.respondWith(
		caches.match(event.request).then((cached) => {
			if (cached) return cached;
			return fetch(event.request).then((response) => {
				if (!response || response.status !== 200 || response.type !== "basic") {
					return response;
				}
				const clone = response.clone();
				caches.open(CACHE_NAME).then((cache) => {
					cache.put(event.request, clone);
				});
				return response;
			}).catch(() => {
				if (event.request.headers?.get?.("accept")?.includes("text/html")) {
					return caches
						.match("./")
						.then((r) => r || caches.match("./index.html"));
				}
			});
		}),
	);
});
`;
}

export function injectPwaRegistration(html) {
	if (
		html.includes("gofront-pwa") ||
		html.includes("navigator.serviceWorker.register")
	) {
		return html;
	}
	if (/<\/body>/i.test(html)) {
		return html.replace(/<\/body>/i, () => `${PWA_REGISTER_SNIPPET}\n</body>`);
	}
	return `${html}\n${PWA_REGISTER_SNIPPET}\n`;
}

export function generatePwa(outDir, options = {}) {
	const resolvedOut = resolve(outDir);
	mkdirSync(resolvedOut, { recursive: true });

	const assets = collectPwaAssets(resolvedOut);
	const version = options.version ?? `v${Date.now().toString(36)}`;
	const swName = options.swName ?? "sw.js";
	const swPath = join(resolvedOut, swName);

	const swSource = generateServiceWorkerSource(assets, version);
	writeFileSync(swPath, swSource);

	const indexPath = join(resolvedOut, "index.html");
	if (existsSync(indexPath)) {
		const html = readFileSync(indexPath, "utf8");
		const updatedHtml = injectPwaRegistration(html);
		if (updatedHtml !== html) {
			writeFileSync(indexPath, updatedHtml);
		}
	}

	return {
		swPath,
		assetsCount: assets.length,
		version,
		assets,
	};
}
