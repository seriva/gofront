// GoFront type system — shared type constants, predicates, and utilities
// used across the type-checker sub-modules.
//
// Type representation:
//   { kind: 'basic',     name: 'int'|'float64'|'string'|'bool'|'any'|'void' }
//   { kind: 'slice',     elem: Type }
//   { kind: 'array',     size: n, elem: Type }
//   { kind: 'map',       key: Type, value: Type }
//   { kind: 'struct',    name: string, fields: Map<string, Type>, methods: Map<string, FuncType> }
//   { kind: 'interface', name: string, methods: Map<string, FuncType> }
//   { kind: 'func',      params: Type[], returns: Type[]  }
//   { kind: 'tuple',     types: Type[] }   ← multiple return values
//   { kind: 'named',     name: string, underlying: Type }

export class TypeCheckError extends Error {
	constructor(msg, node, filename, sourceCode) {
		const lineNum = node?.line || node?._line;
		const loc = filename
			? lineNum
				? ` in ${filename} at line ${lineNum}`
				: ` in ${filename}`
			: lineNum
				? ` at line ${lineNum}`
				: "";
		let lineContext = "";
		if (lineNum && sourceCode) {
			const lines = sourceCode.split("\n");
			const lineStr = lines[lineNum - 1];
			if (lineStr !== undefined) {
				lineContext = `\n  ${lineNum} | ${lineStr}`;
			}
		}
		super(`Type error${loc}: ${msg}${lineContext}`);
	}
}

// ── Static operator sets (module-level for reuse) ────────────
export const CMP_OPS = new Set(["==", "!=", "<", ">", "<=", ">="]);
export const LOG_OPS = new Set(["&&", "||"]);

// ── Built-in types ───────────────────────────────────────────

export const INT = { kind: "basic", name: "int" };
export const FLOAT64 = { kind: "basic", name: "float64" };
export const STRING = { kind: "basic", name: "string" };
export const BOOL = { kind: "basic", name: "bool" };
export const ANY = { kind: "basic", name: "any" };
export const VOID = { kind: "basic", name: "void" };
export const NIL = { kind: "basic", name: "nil" };
export const ERROR = {
	kind: "interface",
	name: "error",
	methods: new Map([
		["Error", { kind: "func", params: [], returns: [STRING], async: false }],
	]),
};

// ── Untyped constant types (Go spec §Constants) ─────────────
// Untyped constants coerce to any compatible typed context.
export const UNTYPED_INT = { kind: "untyped", base: "int" };
export const UNTYPED_FLOAT = { kind: "untyped", base: "float64" };
export const UNTYPED_STRING = { kind: "untyped", base: "string" };
export const UNTYPED_BOOL = { kind: "untyped", base: "bool" };

// ── Complex types ────────────────────────────────────────────
export const COMPLEX128 = { kind: "basic", name: "complex128" };
export const COMPLEX64 = { kind: "basic", name: "complex64" };
export const UNTYPED_COMPLEX = { kind: "untyped", base: "complex128" };

export const BASIC_TYPES = {
	int: INT,
	float64: FLOAT64,
	string: STRING,
	bool: BOOL,
	any: ANY,
	byte: INT,
	rune: INT,
	// Sized integer / float aliases — all map to int or float64 at runtime
	uint: INT,
	int8: INT,
	int16: INT,
	int32: INT,
	int64: INT,
	uint8: INT,
	uint16: INT,
	uint32: INT,
	uint64: INT,
	uintptr: INT,
	float32: FLOAT64,
	complex64: COMPLEX64,
	complex128: COMPLEX128,
};

export function isNumeric(t) {
	if (!t) return false;
	if (t.kind === "untyped") return t.base === "int" || t.base === "float64";
	if (t.kind === "basic") return t.name === "int" || t.name === "float64";
	if (t.kind === "named") return isNumeric(t.underlying);
	return false;
}
export function isComplex(t) {
	if (!t) return false;
	if (t.kind === "basic" && (t.name === "complex128" || t.name === "complex64"))
		return true;
	if (t.kind === "untyped" && t.base === "complex128") return true;
	if (t.kind === "named") return isComplex(t.underlying);
	return false;
}
export function isComplexOrNumeric(t) {
	return isNumeric(t) || isComplex(t);
}
export function isString(t) {
	if (!t) return false;
	if (t.kind === "untyped") return t.base === "string";
	if (t.kind === "basic") return t.name === "string";
	if (t.kind === "named") return isString(t.underlying);
	return false;
}
export function isBool(t) {
	if (!t) return false;
	if (t.kind === "untyped") return t.base === "bool";
	if (t.kind === "basic") return t.name === "bool";
	if (t.kind === "named") return isBool(t.underlying);
	return false;
}
export function isAny(t) {
	return t?.kind === "basic" && t.name === "any";
}
export function isNil(t) {
	return t?.kind === "basic" && t.name === "nil";
}
export function isVoid(t) {
	return t?.kind === "basic" && t.name === "void";
}
export function isError(t) {
	if (!t) return false;
	if (t === ERROR) return true;
	if (t.kind === "interface" && t.name === "error") return true;
	if (t.kind === "named" && isError(t.underlying)) return true;
	return false;
}
export function isPointer(t) {
	if (!t) return false;
	if (t.kind === "pointer") return true;
	if (t.kind === "named") return t.underlying?.kind === "pointer";
	return false;
}
export function isArray(t) {
	if (!t) return false;
	if (t.kind === "array") return true;
	if (t.kind === "named") return t.underlying?.kind === "array";
	return false;
}
export function isUntyped(t) {
	return t?.kind === "untyped";
}

/** Materialize an untyped type to its default concrete type. */
export function defaultType(t) {
	if (t?.kind !== "untyped") return t;
	switch (t.base) {
		case "int":
			return INT;
		case "float64":
			return FLOAT64;
		case "string":
			return STRING;
		case "bool":
			return BOOL;
		case "complex128":
			return COMPLEX128;
		default:
			return ANY;
	}
}

export function typeStr(t) {
	if (!t) return "void";
	if (t.kind === "basic" && t.alias) return t.alias;
	switch (t.kind) {
		case "basic":
			return t.name;
		case "untyped":
			return `untyped ${t.base}`;
		case "slice":
			return `[]${typeStr(t.elem)}`;
		case "array":
			return `[${t.size ?? "..."}]${typeStr(t.elem)}`;
		case "map":
			return `map[${typeStr(t.key)}]${typeStr(t.value)}`;
		case "struct":
			return t.name || "struct{...}";
		case "interface":
			return t.name || "interface{...}";
		case "namespace":
			return t.name || "namespace{...}";
		case "func":
			return `func(${t.params.map(typeStr).join(", ")}) ${typeStr(t.returns[0] ?? VOID)}`;
		case "tuple":
			return `(${t.types.map(typeStr).join(", ")})`;
		case "named":
			return t.name;
		case "pointer":
			return `*${typeStr(t.base)}`;
		default:
			return "?";
	}
}

// ── Iterator function detection (Go 1.23 range-over-func) ───

/**
 * Returns null if t is not an iterator function.
 * Returns { yieldParams: Type[] } if it is, where yieldParams are the
 * types the range variables will be bound to (0, 1, or 2 elements).
 *
 * An iterator is func(yield func(...) bool) — single param that is a
 * func returning bool with 0-2 params.
 */
export function iteratorYieldParams(t) {
	const fn = t?.kind === "named" ? t.underlying : t;
	if (fn?.kind !== "func") return null;
	if (fn.params.length !== 1) return null;
	const yieldFn =
		fn.params[0]?.kind === "named" ? fn.params[0].underlying : fn.params[0];
	if (yieldFn?.kind !== "func") return null;
	if (yieldFn.returns.length !== 1 || !isBool(yieldFn.returns[0])) return null;
	if (yieldFn.params.length > 2) return null;
	return { yieldParams: yieldFn.params };
}

// ── Scope / environment ──────────────────────────────────────

export class Scope {
	constructor(parent = null) {
		this.parent = parent;
		this.symbols = new Map();
		this._consts = new Set(); // names declared as const in this scope
		this._locals = new Set(); // names declared as local variables (var / :=)
		this._used = new Set(); // names referenced in this scope
	}
	define(name, type) {
		this.symbols.set(name, type);
	}
	defineLocal(name, type) {
		this.symbols.set(name, type);
		if (name !== "_") this._locals.add(name);
	}
	defineConst(name, type) {
		this.symbols.set(name, type);
		this._consts.add(name);
	}
	isConst(name) {
		if (this._consts.has(name)) return true;
		// Don't walk parent — shadowing a const with a var in a child scope is valid
		return false;
	}
	lookup(name) {
		if (this.symbols.has(name)) {
			this._used.add(name);
			return this.symbols.get(name);
		}
		if (this.parent) return this.parent.lookup(name);
		return null;
	}
	// Lookup which scope owns the name (to check const flag)
	lookupScope(name) {
		if (this.symbols.has(name)) return this;
		if (this.parent) return this.parent.lookupScope(name);
		return null;
	}
	// Returns local variable names that were never referenced
	unusedLocals() {
		const unused = [];
		for (const name of this._locals) {
			if (!this._used.has(name)) unused.push(name);
		}
		return unused;
	}
}
