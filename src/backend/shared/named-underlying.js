// The full underlying type of a checker `named` type.  A resolved named type
// carries it as `underlying` (never itself a defined type); a bare
// `{ kind: "named", name }` (method receivers, interface candidates) is looked
// up once in the checker's type table.  Returns null when neither has one, or
// when the table entry is the type itself (a placeholder).
export function namedUnderlying(t, checker) {
	if (t?.kind !== "named") return null;
	if (t.underlying) return t.underlying;
	const entry = checker?.types?.get(t.name);
	return entry && entry !== t ? (entry.underlying ?? null) : null;
}

// The first non-`named` type reached by following `namedUnderlying` from `t`
// (`t` itself when it is not a `named` type).  Returns null when a named type
// has no underlying type or the chain is a cycle (`type A B; type B A`
// registered in the checker's table), so callers never recurse forever.
export function namedBase(t, checker) {
	const seen = new Set();
	let cur = t;
	while (cur?.kind === "named") {
		if (seen.has(cur) || seen.has(cur.name) || seen.size > 64) return null;
		seen.add(cur);
		seen.add(cur.name);
		cur = namedUnderlying(cur, checker);
	}
	return cur ?? null;
}
