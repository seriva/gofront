// src/typechecker/stdlib/excluded.js
// Stdlib packages and members that the manifest excludes (stdlib/manifest.json,
// `excluded:` status) and that get a targeted diagnostic with the manifest's
// note (or category reason) instead of the generic `No member` error.

import { readFileSync } from "node:fs";

const MANIFEST_URL = new URL("../../../stdlib/manifest.json", import.meta.url);
const manifest = JSON.parse(readFileSync(MANIFEST_URL, "utf8"));

const pkgIdent = (pkg) =>
	pkg
		.split("/")
		.filter((s) => !/^v\d+$/.test(s))
		.at(-1);

export const EXCLUDED_STDLIB_PACKAGES = new Map();

export const EXCLUDED_STDLIB_MEMBERS = new Map([
	[
		"Context.Done",
		"Done() returns a channel; use ctx.Err() != nil or context.AfterFunc",
	],
	[
		"context.Context.Done",
		"Done() returns a channel; use ctx.Err() != nil or context.AfterFunc",
	],
	["rand.ChaCha8", "ChaCha8 is deferred (code size)"],
	["rand.NewChaCha8", "ChaCha8 is deferred (code size)"],
	["iter.Pull", "requires coroutines; out of scope (no runtime)"],
	["iter.Pull2", "requires coroutines; out of scope (no runtime)"],
	["time.After", "channels"],
	["time.Tick", "channels"],
	["time.NewTicker", "channels"],
	["time.NewTimer", "channels"],
	["time.Ticker", "channels"],
	["time.Timer.C", "channels"],
	["sync.Cond", "blocking wait"],
	["sync.Cond.Broadcast", "blocking wait"],
	["sync.Cond.L", "blocking wait"],
	["sync.Cond.Signal", "blocking wait"],
	["sync.Cond.Wait", "blocking wait"],
	["sync.NewCond", "blocking wait"],
	["sync.WaitGroup.Go", "starts a goroutine"],
	["testing.T.TempDir", "file system"],
	["testing.T.Chdir", "file system"],
	["testing.T.ArtifactDir", "file system"],
	["testing.B.TempDir", "file system"],
	["testing.B.Chdir", "file system"],
	["testing.B.ArtifactDir", "file system"],
	["testing.B.RunParallel", "goroutines"],
	["testing.B.SetParallelism", "goroutines"],
	["testing.TB.TempDir", "file system"],
	["testing.TB.Chdir", "file system"],
	["testing.TB.ArtifactDir", "file system"],
]);

for (const e of manifest.entries) {
	if (!e.status?.startsWith("excluded:")) continue;
	const reason = e.note ?? e.status.slice("excluded:".length);
	if (e.kind === "package") {
		if (!EXCLUDED_STDLIB_PACKAGES.has(e.pkg)) {
			EXCLUDED_STDLIB_PACKAGES.set(e.pkg, reason);
		}
		continue;
	}
	const fullKey = `${e.pkg}.${e.name}`;
	if (!EXCLUDED_STDLIB_MEMBERS.has(fullKey)) {
		EXCLUDED_STDLIB_MEMBERS.set(fullKey, reason);
	}
	const key = `${pkgIdent(e.pkg)}.${e.name}`;
	if (!EXCLUDED_STDLIB_MEMBERS.has(key)) {
		EXCLUDED_STDLIB_MEMBERS.set(key, reason);
	}
	const rawLast = e.pkg.split("/").at(-1);
	const rawKey = `${rawLast}.${e.name}`;
	if (!EXCLUDED_STDLIB_MEMBERS.has(rawKey)) {
		EXCLUDED_STDLIB_MEMBERS.set(rawKey, reason);
	}
}
