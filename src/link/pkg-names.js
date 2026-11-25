// Names that local packages share.
//
// Every local package is inlined into one flat JS module and linked into one
// flat WebAssembly module.  `pkgSuffix` gives each package a suffix that is
// unique in the build; names that must stay apart (a package's `init`) carry
// it.

// The suffix (`$$util`) of the local package in `pkgKey` (its directory)
// named `pkgName`.  `suffixes` is the build's table of the suffixes it handed
// out: the first package of a name takes the bare name and a later one in
// another directory gets `util__2`, so `p1/util` and `p2/util` stay apart.
export function pkgSuffix(suffixes, pkgKey, pkgName) {
	const known = suffixes.get(pkgKey);
	if (known) return known;
	const taken = new Set(suffixes.values());
	let suffix = `$$${pkgName}`;
	for (let n = 2; taken.has(suffix); n++) suffix = `$$${pkgName}__${n}`;
	suffixes.set(pkgKey, suffix);
	return suffix;
}
