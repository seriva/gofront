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
