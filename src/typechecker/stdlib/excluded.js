// src/typechecker/stdlib/excluded.js
// Stdlib members that the manifest excludes (stdlib/manifest.json,
// `excluded:` status) and that get a targeted diagnostic with the manifest's
// note instead of the generic `No member` error.

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
