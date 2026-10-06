// src/lower/functions.js
// Analyzes function signatures, named returns and defer structures.

export function extractNamedReturns(decl) {
	const named = decl?.returnType?._namedReturns;
	if (!named || named.length === 0) return null;
	return {
		entries: named, // [{ name, type }]
		names: named.map((r) => r.name).filter(Boolean),
	};
}

export function hasDefer(body) {
	if (!body) return false;
	if (body._hasDefer != null) return Boolean(body._hasDefer);

	const walk = (node) => {
		if (!node || typeof node !== "object") return false;
		if (Array.isArray(node)) return node.some(walk);
		if (node.kind === "DeferStmt") return true;
		if (node.kind === "FuncLit") return false; // separate function boundary
		for (const key of Object.keys(node)) {
			if (key.startsWith("_")) continue;
			if (walk(node[key])) return true;
		}
		return false;
	};

	return walk(body);
}
