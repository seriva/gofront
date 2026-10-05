// src/lower/boxing.js
// Identifies address-taken scalar variables that require heap boxing ({ value: x }).

export function isReferenceType(t) {
	if (!t) return false;
	const base = t.kind === "named" ? t.underlying : t;
	return (
		base?.kind === "struct" ||
		base?.kind === "slice" ||
		base?.kind === "map" ||
		base?.kind === "func" ||
		base?.kind === "interface"
	);
}

// Scan AST node for _addressTaken idents on scalars and populate a Set of boxed variable names.
export function scanAddressTaken(node, boxedVars = new Set()) {
	if (!node || typeof node !== "object") return boxedVars;
	if (Array.isArray(node)) {
		for (const child of node) scanAddressTaken(child, boxedVars);
		return boxedVars;
	}
	// &x — the operand ident will have _addressTaken set by typechecker
	if (node.kind === "Ident" && node._addressTaken) {
		const t = node._type;
		if (t && !isReferenceType(t)) {
			boxedVars.add(node.name);
		}
	}
	// Recurse into FuncLit too — closures may take address of outer vars
	for (const key of Object.keys(node)) {
		if (key.startsWith("_")) continue;
		scanAddressTaken(node[key], boxedVars);
	}
	return boxedVars;
}
