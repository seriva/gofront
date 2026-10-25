// src/typechecker/stdlib/excluded.js
// Stdlib members that the manifest excludes (runtime/stdlib/manifest.json,
// `excluded:` status) and that get a targeted diagnostic with the manifest's
// note instead of the generic `No member` error.

export const EXCLUDED_STDLIB_MEMBERS = new Map([
	["iter.Pull", "requires coroutines; out of scope (no runtime)"],
	["iter.Pull2", "requires coroutines; out of scope (no runtime)"],
	["time.After", "channels"],
	["time.Tick", "channels"],
	["time.NewTicker", "channels"],
	["time.NewTimer", "channels"],
	["time.Ticker", "channels"],
	["time.Timer.C", "channels"],
]);
