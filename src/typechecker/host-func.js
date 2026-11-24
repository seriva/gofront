// A variable that holds a function JavaScript implements (`fn := console.log`)
// is called as JavaScript calls it: arguments reach the function as they are.
// A variable assigned again may hold a Go function, so it is called as one
// (as for `var fn func(...any) = console.log`).

// The names a plain assignment (`name = value`) writes under `node`.
export function assignedNames(node, out = new Set()) {
	if (!node || typeof node !== "object") return out;
	if (Array.isArray(node)) {
		for (const n of node) assignedNames(n, out);
		return out;
	}
	if (node.kind === "AssignStmt" && node.op === "=")
		for (const l of node.lhs) if (l?.kind === "Ident") out.add(l.name);
	for (const key of Object.keys(node)) {
		if (key.charCodeAt(0) === 95) continue; // "_" side tables
		assignedNames(node[key], out);
	}
	return out;
}

// The Go func type of the `func` type `t` a `.d.ts` declares: the same
// signature, without the marks that make a call pass arguments through.
export function goFuncType(t) {
	const { _hostFunc, ...go } = t;
	const plain = (p) => {
		if (!p?._hostAny) return p;
		const { _hostAny, ...rest } = p;
		return rest;
	};
	go.params = t.params.map(plain);
	return go;
}
