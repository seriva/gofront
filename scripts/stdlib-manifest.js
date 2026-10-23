#!/usr/bin/env node
// Generates runtime/stdlib/manifest.json, the stdlib coverage manifest, from
// Go's API files ($(go env GOROOT)/api/go1.txt … go1.26.txt).  The manifest is
// checked in, so CI and the coverage tests never need a Go toolchain.
//
//   node scripts/stdlib-manifest.js            write the manifest
//   node scripts/stdlib-manifest.js --check    fail when the file is stale
//   --api <dir>                                read the API files from <dir>
//
// Each entry is { pkg, name, kind, signature, status } (plus `recv` for
// methods).  Kinds are the API line kinds (func, type, var, const, method)
// plus `field` for struct fields and interface methods' `method`.  A package
// that is excluded as a whole gets one `package` entry instead of members.

import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export const GO_VERSION = "go1.26";
export const MANIFEST_PATH = fileURLToPath(
	new URL("../runtime/stdlib/manifest.json", import.meta.url),
);

// ── Scope rule (docs/v1.8.0/portable-go-plan.md#scope-rule) ──────────────
//
// In-scope packages: the packages the scope rule and its member tables name,
// the packages the plan adds (§4–§9), and the packages GoFront already ships.
// Their members start as `todo`.
export const IN_SCOPE_PACKAGES = [
	"bufio",
	"bytes",
	"cmp",
	"container/heap",
	"container/list",
	"container/ring",
	"context",
	"crypto/hmac",
	"crypto/md5",
	"crypto/rand",
	"crypto/sha1",
	"crypto/sha256",
	"crypto/sha512",
	"crypto/subtle",
	"encoding/base32",
	"encoding/base64",
	"encoding/binary",
	"encoding/csv",
	"encoding/hex",
	"encoding/json",
	"errors",
	"fmt",
	"hash",
	"hash/adler32",
	"hash/crc32",
	"hash/fnv",
	"html",
	"io",
	"iter",
	"log",
	"maps",
	"math",
	"math/bits",
	"math/cmplx",
	"math/rand",
	"math/rand/v2",
	"net/url",
	"os",
	"path",
	"path/filepath",
	"regexp",
	"slices",
	"sort",
	"strconv",
	"strings",
	"sync",
	"sync/atomic",
	"testing",
	"time",
	"unicode",
	"unicode/utf16",
	"unicode/utf8",
];

// The excluded categories of the scope rule.  "JS-only by design" is not an
// exclusion: those members get status `js`.
export const EXCLUDED_CATEGORIES = [
	"runtime",
	"host",
	"reflection",
	"deferred",
];

// Every other package, by category.  An entry ending in `/*` covers the
// package and everything below it.  Pure packages the scope rule does not
// list are `deferred` (revived by a separate plan, never ad hoc).
const EXCLUDED_PACKAGES = {
	runtime: [
		"reflect",
		"runtime",
		"runtime/*",
		"weak",
		"unique",
		"plugin",
		"structs",
		"testing/synctest",
	],
	host: [
		"net",
		"net/http",
		"net/http/*",
		"net/rpc",
		"net/rpc/*",
		"net/smtp",
		"net/textproto",
		"os/exec",
		"os/signal",
		"os/user",
		"syscall",
		"io/fs",
		"io/ioutil",
		"database/sql",
		"database/sql/*",
		"log/syslog",
		"expvar",
		"mime/multipart",
		"testing/fstest",
	],
	reflection: [
		"text/template",
		"html/template",
		"encoding/xml",
		"encoding/gob",
		"flag",
		"testing/quick",
	],
	deferred: [
		"math/big",
		"compress/*",
		"archive/*",
		"image",
		"image/*",
		"crypto",
		"crypto/aes",
		"crypto/cipher",
		"crypto/des",
		"crypto/dsa",
		"crypto/ecdh",
		"crypto/ecdsa",
		"crypto/ed25519",
		"crypto/elliptic",
		"crypto/fips140",
		"crypto/hkdf",
		"crypto/hpke",
		"crypto/mlkem",
		"crypto/mlkem/*",
		"crypto/pbkdf2",
		"crypto/rc4",
		"crypto/rsa",
		"crypto/sha3",
		"crypto/tls",
		"crypto/x509",
		"crypto/x509/*",
		"encoding",
		"encoding/asn1",
		"encoding/pem",
		"encoding/ascii85",
		"text/tabwriter",
		"text/scanner",
		"text/template/parse",
		"go/*",
		"debug/*",
		"hash/crc64",
		"hash/maphash",
		"embed",
		"index/suffixarray",
		"log/slog",
		"mime",
		"mime/quotedprintable",
		"net/mail",
		"net/netip",
		"regexp/syntax",
		"testing/cryptotest",
		"testing/iotest",
		"testing/slogtest",
	],
};

// Returns `todo` for an in-scope package, `excluded:<category>` for an
// excluded one, and null for a package the scope rule does not classify.
export function packageStatus(pkg) {
	if (IN_SCOPE_PACKAGES.includes(pkg)) return "todo";
	for (const [category, patterns] of Object.entries(EXCLUDED_PACKAGES))
		for (const p of patterns)
			if (p.endsWith("/*") ? pkg.startsWith(p.slice(0, -1)) : pkg === p)
				return `excluded:${category}`;
	return null;
}

// ── API file parsing ─────────────────────────────────────────────────────

// go1.txt, go1.1.txt … go1.26.txt in release order.
function apiFiles(apiDir) {
	const minor = (f) => Number(f.match(/^go1(?:\.(\d+))?\.txt$/)?.[1] ?? 0);
	const files = readdirSync(apiDir)
		.filter((f) => /^go1(\.\d+)?\.txt$/.test(f))
		.sort((a, b) => minor(a) - minor(b));
	const last = `${GO_VERSION}.txt`;
	if (!files.includes(last))
		throw new Error(`${apiDir} has no ${last}; install ${GO_VERSION}`);
	return files.slice(0, files.indexOf(last) + 1);
}

// Strips the proposal suffix (` #12345`) and trailing comments.
function cleanLine(line) {
	return line.replace(/\s+#\d+$/, "").trim();
}

// Splits `(*T) Name(args) results` into receiver, name and `func(…) …`.
function parseMethod(rest) {
	const m = rest.match(/^\(([^)]*)\) (\w+)(.*)$/);
	if (!m) return null;
	const recv = m[1];
	return {
		name: `${recv.replace(/^\*/, "").replace(/\[.*$/, "")}.${m[2]}`,
		recv,
		signature: `func${m[3]}`,
	};
}

// Splits `Name[$0 C] def` (type parameters optional, brackets nested).
function splitTypeHead(rest) {
	const name = rest.match(/^\w+/)?.[0];
	if (!name) return null;
	let i = name.length;
	if (rest[i] === "[") {
		for (let depth = 0; i < rest.length; i++) {
			if (rest[i] === "[") depth++;
			else if (rest[i] === "]" && --depth === 0) break;
		}
		i++;
	}
	if (rest[i] !== " ") return null;
	return { name, tparams: rest.slice(name.length, i), def: rest.slice(i + 1) };
}

// Parses the text after `pkg <path>, ` into a manifest entry (without
// status), or returns null for a line that is not an API feature.
export function parseFeature(feature) {
	const sp = feature.indexOf(" ");
	const kind = feature.slice(0, sp);
	const rest = feature.slice(sp + 1);
	switch (kind) {
		case "func": {
			const m = rest.match(/^(\w+)(.*)$/);
			return m && { kind, name: m[1], signature: `func${m[2]}` };
		}
		case "method": {
			const m = parseMethod(rest);
			return m && { kind, ...m };
		}
		case "var":
		case "const": {
			const m = rest.match(/^(\w+) (.*)$/);
			if (!m) return null;
			// `const X = 1` value lines accompany `const X ideal-int`/`const X T`.
			if (kind === "const" && m[2].startsWith("= ")) return null;
			return { kind, name: m[1], signature: m[2].replace(/\s+\/\/.*$/, "") };
		}
		case "type": {
			const m = splitTypeHead(rest);
			if (!m) return null;
			const { name, tparams, def } = m;
			// `type T struct, Field X`, `type T struct, embedded X`,
			// `type I interface, M(…) …`
			const sub = def.match(/^(struct|interface), (.*)$/);
			if (!sub)
				return { kind, name, signature: tparams ? `${tparams} ${def}` : def };
			if (sub[1] === "struct") {
				const e = sub[2].match(/^embedded (.*)$/);
				if (e) {
					const base = e[1].replace(/^\*/, "").replace(/^.*\./, "");
					return {
						kind: "field",
						name: `${name}.${base.replace(/\[.*$/, "")}`,
						signature: `embedded ${e[1]}`,
					};
				}
				const f = sub[2].match(/^(\w+) (.*)$/);
				return f && { kind: "field", name: `${name}.${f[1]}`, signature: f[2] };
			}
			const im = sub[2].match(/^(\w+)(.*)$/);
			if (!im) return null;
			// An embedded interface (`type ReadWriter interface, Read(…)` lists
			// the promoted methods, so a bare name is skipped).
			if (!im[2].startsWith("(")) return null;
			return {
				kind: "method",
				name: `${name}.${im[1]}`,
				recv: `${name}${tparams}`,
				signature: `func${im[2]}`,
			};
		}
		default:
			return null;
	}
}

const entryKey = (e) => `${e.pkg} ${e.kind} ${e.name}`;

// Reads every API file and returns the features of the current Go release:
// Map key -> entry, later releases overriding earlier ones, minus except.txt.
function readFeatures(apiDir) {
	const exceptPath = join(apiDir, "except.txt");
	const except = new Set(
		existsSync(exceptPath)
			? readFileSync(exceptPath, "utf8").split("\n").map(cleanLine)
			: [],
	);
	const features = new Map();
	const packages = new Set();
	for (const file of apiFiles(apiDir)) {
		for (const raw of readFileSync(join(apiDir, file), "utf8").split("\n")) {
			const line = cleanLine(raw);
			const m = line.match(/^pkg ([^ ,]+)( \([^)]*\))?, (.*)$/);
			if (!m) continue;
			packages.add(m[1]);
			// Platform-specific lines (`pkg os (linux-386), …`) and deprecation
			// markers are not portable API features.
			if (m[2] || m[3].includes("//deprecated") || except.has(line)) continue;
			const entry = parseFeature(m[3]);
			if (entry) features.set(entryKey({ pkg: m[1], ...entry }), entry);
		}
	}
	return { features, packages };
}

// ── Manifest ─────────────────────────────────────────────────────────────

export function buildManifest(apiDir) {
	const { features, packages } = readFeatures(apiDir);
	const unclassified = [...packages].filter((p) => packageStatus(p) === null);
	if (unclassified.length > 0)
		throw new Error(
			`packages missing from the scope rule: ${unclassified.sort().join(", ")}`,
		);
	const entries = [];
	for (const pkg of [...packages].sort()) {
		const status = packageStatus(pkg);
		if (status !== "todo") {
			entries.push({ pkg, name: "", kind: "package", signature: "", status });
			continue;
		}
		const members = [];
		for (const [key, e] of features) {
			if (!key.startsWith(`${pkg} `)) continue;
			members.push({
				pkg,
				name: e.name,
				kind: e.kind,
				signature: e.signature,
				...(e.recv ? { recv: e.recv } : {}),
				status,
			});
		}
		members.sort(
			(a, b) =>
				a.name.localeCompare(b.name, "en") || a.kind.localeCompare(b.kind),
		);
		entries.push(...members);
	}
	return { go: GO_VERSION, entries };
}

// Biome's JSON layout (tab-indented, one field per line), so formatting the
// checked-in file is a no-op.
export function serializeManifest(manifest) {
	return `${JSON.stringify(manifest, null, "\t")}\n`;
}

function defaultApiDir() {
	const goroot = execFileSync("go", ["env", "GOROOT"], {
		encoding: "utf8",
	}).trim();
	return join(goroot, "api");
}

function main(argv) {
	const apiAt = argv.indexOf("--api");
	const apiDir = apiAt >= 0 ? argv[apiAt + 1] : defaultApiDir();
	const text = serializeManifest(buildManifest(apiDir));
	if (argv.includes("--check")) {
		const current = existsSync(MANIFEST_PATH)
			? readFileSync(MANIFEST_PATH, "utf8")
			: "";
		if (current !== text) {
			console.error(
				"runtime/stdlib/manifest.json is stale; run npm run manifest:update",
			);
			process.exit(1);
		}
		return;
	}
	writeFileSync(MANIFEST_PATH, text);
}

if (process.argv[1] === fileURLToPath(import.meta.url))
	main(process.argv.slice(2));
