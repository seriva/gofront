// A variable that holds a function JavaScript implements (`fn := console.log`)
// is called as JavaScript calls it: arguments reach the function as they are.
// A variable that may be assigned a Go function is called as one instead
// (as for `var fn func(...any) = console.log`); assigning it another function
// JavaScript implements (`fn = console.warn`) or `nil` changes nothing.

// What `node` (a function body, or every declaration of a package) stores into
// its variables and how often it binds each name:
//   stores: name -> the values assigned to it (`name = v`, a redeclaring
//     `a, name := ...`), `null` standing for a value that cannot be told apart
//     (a call's result, a range, a store through the address `&name`);
//   bound: name -> how many times a declaration binds it, so a name that more
//     than one declaration binds cannot be trusted to mean one variable;
//   defs: name -> the value that declares it (`name := v`, `var name = v`).
export function scanStores(
	node,
	out = { stores: new Map(), bound: new Map(), defs: new Map() },
) {
	if (!node || typeof node !== "object") return out;
	if (Array.isArray(node)) {
		for (const n of node) scanStores(n, out);
		return out;
	}
	SCANNERS[node.kind]?.(node, out);
	for (const key of Object.keys(node)) {
		if (key.charCodeAt(0) === 95) continue; // "_" side tables
		scanStores(node[key], out);
	}
	return out;
}

const store = (out, name, value) => {
	const values = out.stores.get(name) ?? [];
	values.push(value);
	out.stores.set(name, values);
};

const bind = (out, name) => {
	if (name) out.bound.set(name, (out.bound.get(name) ?? 0) + 1);
};

// The value `stmt` gives its i-th target, null when one call gives several.
const valueAt = (stmt, i) =>
	stmt.rhs.length === stmt.lhs.length ? stmt.rhs[i] : null;

const SCANNERS = {
	AssignStmt(node, out) {
		if (node.op !== "=") return;
		node.lhs.forEach((l, i) => {
			if (l?.kind === "Ident") store(out, l.name, valueAt(node, i));
		});
	},
	DefineStmt(node, out) {
		node.lhs.forEach((l, i) => {
			if (l?.kind !== "Ident") return;
			bind(out, l.name);
			if (valueAt(node, i)) out.defs.set(l.name, node.rhs[i]);
			// With a second name `:=` may redeclare this one: an assignment.
			if (node.lhs.length > 1) store(out, l.name, valueAt(node, i));
		});
	},
	UnaryExpr(node, out) {
		if (node.op === "&" && node.operand?.kind === "Ident")
			store(out, node.operand.name, null);
	},
	VarDecl(node, out) {
		for (const d of node.decls ?? [])
			d.names?.forEach((n, i) => {
				const name = typeof n === "string" ? n : n?.name;
				bind(out, name);
				if (!d.type && d.value?.length === d.names.length)
					out.defs.set(name, d.value[i]);
			});
	},
	FuncLit(node, out) {
		for (const p of node.params ?? []) bind(out, p.name);
	},
	TypeSwitchStmt(node, out) {
		bind(out, node.assign);
	},
};

// The Go func type of the `func` type `t` a `.d.ts` declares: the same
// signature, without the marks that make a call pass arguments through.
// A `.d.ts` call may leave optional arguments out; a Go call may not.
export function goFuncType(t) {
	const go = { ...t };
	delete go._hostFunc;
	delete go.minArgs;
	const plain = (p) => {
		if (!p?._hostAny) return p;
		const { _hostAny, ...rest } = p;
		return rest;
	};
	go.params = t.params.map(plain);
	return go;
}
