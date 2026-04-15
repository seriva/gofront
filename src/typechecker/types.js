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
export const ERROR = { kind: "basic", name: "error" };

export const BASIC_TYPES = {
	int: INT,
	float64: FLOAT64,
	string: STRING,
	bool: BOOL,
	any: ANY,
	byte: INT,
	rune: INT,
	error: ERROR,
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
};

export function isNumeric(t) {
	return t.kind === "basic" && (t.name === "int" || t.name === "float64");
}
export function isString(t) {
	return t.kind === "basic" && t.name === "string";
}
export function isBool(t) {
	return t.kind === "basic" && t.name === "bool";
}
export function isAny(t) {
	return t.kind === "basic" && t.name === "any";
}
export function isNil(t) {
	return t.kind === "basic" && t.name === "nil";
}
export function isVoid(t) {
	return t.kind === "basic" && t.name === "void";
}
export function isError(t) {
	return t.kind === "basic" && t.name === "error";
}

export function typeStr(t) {
	if (!t) return "void";
	if (t.kind === "basic" && t.alias) return t.alias;
	switch (t.kind) {
		case "basic":
			return t.name;
		case "slice":
			return `[]${typeStr(t.elem)}`;
		case "array":
			return `[${t.size}]${typeStr(t.elem)}`;
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

// ── Scope / environment ──────────────────────────────────────

export class Scope {
	constructor(parent = null) {
		this.parent = parent;
		this.symbols = new Map();
		this._consts = new Set(); // names declared as const in this scope
	}
	define(name, type) {
		this.symbols.set(name, type);
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
		if (this.symbols.has(name)) return this.symbols.get(name);
		if (this.parent) return this.parent.lookup(name);
		return null;
	}
	// Lookup which scope owns the name (to check const flag)
	lookupScope(name) {
		if (this.symbols.has(name)) return this;
		if (this.parent) return this.parent.lookupScope(name);
		return null;
	}
}
