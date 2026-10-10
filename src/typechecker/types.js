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
	constructor(msg, node, filename, sourceCode, hint = null) {
		const lineNum = node?.line || node?._line;
		const colNum = node?.col || node?._col;
		const loc = filename
			? lineNum
				? ` in ${filename} at line ${lineNum}:${colNum ?? 1}`
				: ` in ${filename}`
			: lineNum
				? ` at line ${lineNum}:${colNum ?? 1}`
				: "";
		const hintText = hint ? `\n  ${hint}` : "";
		let lineContext = "";
		if (lineNum && sourceCode) {
			const lines = sourceCode.split("\n");
			const lineStr = lines[lineNum - 1];
			if (lineStr !== undefined) {
				const prefix = `  ${lineNum} | `;
				const caretPad = " ".repeat((colNum ?? 1) - 1);
				lineContext = `\n${prefix}${lineStr}\n${" ".repeat(prefix.length)}${caretPad}^`;
			}
		}
		super(`Type error${loc}: ${msg}${hintText}${lineContext}`);
		this.line = lineNum;
		this.col = colNum;
	}
}

export const BROWSER_GLOBALS = new Set([
	"console",
	"document",
	"window",
	"navigator",
	"location",
	"history",
	"screen",
	"performance",
	"crypto",
	"indexedDB",
	"fetch",
	"setTimeout",
	"setInterval",
	"clearTimeout",
	"clearInterval",
	"requestAnimationFrame",
	"cancelAnimationFrame",
	"Math",
	"JSON",
	"Date",
	"RegExp",
	"Promise",
	"Error",
	"Symbol",
	"String",
	"Number",
	"Boolean",
	"Array",
	"Object",
	"parseInt",
	"parseFloat",
	"isNaN",
	"isFinite",
	"encodeURIComponent",
	"decodeURIComponent",
	"atob",
	"btoa",
	"alert",
	"confirm",
	"prompt",
	"localStorage",
	"sessionStorage",
]);

// Stdlib packages the WASM backend can emit. Extend as src/backend/wasm/emit.js gains support;
// anything not listed is rejected at import with "not yet available in wasm packages".
export const WASM_SUPPORTED_STDLIB = new Set(["math", "math/bits", "testing"]);

export const VALID_TARGETS = new Set(["js", "wasm", "both"]);

// ── Static operator sets (module-level for reuse) ────────────
export const CMP_OPS = new Set(["==", "!=", "<", ">", "<=", ">="]);
export const LOG_OPS = new Set(["&&", "||"]);

// ── Built-in types ───────────────────────────────────────────

export const INT = { kind: "basic", name: "int" };
export const INT8 = { kind: "basic", name: "int8" };
export const INT16 = { kind: "basic", name: "int16" };
export const INT32 = { kind: "basic", name: "int32" };
const INT64 = { kind: "basic", name: "int64" };
export const UINT = { kind: "basic", name: "uint" };
export const UINT8 = { kind: "basic", name: "uint8" };
export const BYTE = UINT8;
export const UINT16 = { kind: "basic", name: "uint16" };
export const UINT32 = { kind: "basic", name: "uint32" };
export const UINT64 = { kind: "basic", name: "uint64" };
const UINTPTR = { kind: "basic", name: "uintptr" };
export const RUNE = INT32;
export const FLOAT32 = { kind: "basic", name: "float32" };
export const FLOAT64 = { kind: "basic", name: "float64" };
export const STRING = { kind: "basic", name: "string" };
export const BOOL = { kind: "basic", name: "bool" };
export const ANY = { kind: "basic", name: "any" };
export const TAINTED_ANY = { kind: "basic", name: "any", _tainted: true };
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
const COMPLEX64 = { kind: "basic", name: "complex64" };
export const UNTYPED_COMPLEX = { kind: "untyped", base: "complex128" };

export const BASIC_TYPES = {
	int: INT,
	int8: INT8,
	int16: INT16,
	int32: INT32,
	int64: INT64,
	uint: UINT,
	uint8: UINT8,
	uint16: UINT16,
	uint32: UINT32,
	uint64: UINT64,
	uintptr: UINTPTR,
	byte: UINT8,
	rune: RUNE,
	float32: FLOAT32,
	float64: FLOAT64,
	complex64: COMPLEX64,
	complex128: COMPLEX128,
	string: STRING,
	bool: BOOL,
	any: ANY,
};

export const COMPARABLE = { kind: "basic", name: "comparable" };

export const SIZED_INT_NAMES = [
	"int",
	"int8",
	"int16",
	"int32",
	"int64",
	"uint",
	"uint8",
	"uint16",
	"uint32",
	"uint64",
	"uintptr",
	"byte",
	"rune",
];

export const SIZED_FLOAT_NAMES = ["float32", "float64"];

function makeBasicPredicate(...names) {
	const set = new Set(names);
	const pred = (t) => {
		if (!t) return false;
		if (t.kind === "untyped") return set.has(t.base);
		if (t.kind === "basic") return set.has(t.name);
		if (t.kind === "named") return pred(t.underlying);
		return false;
	};
	return pred;
}

export const isNumeric = makeBasicPredicate(
	...SIZED_INT_NAMES,
	...SIZED_FLOAT_NAMES,
);
export const isInteger = makeBasicPredicate(...SIZED_INT_NAMES);
export const isFloat = makeBasicPredicate(...SIZED_FLOAT_NAMES);
export const isString = makeBasicPredicate("string");
export const isBool = makeBasicPredicate("bool");

// ── TypedArray mappings ──────────────────────────────────────
// []float64 deliberately stays a plain Array for JSON / JS-library interop.
const TYPED_ARRAY_CONSTRUCTORS = {
	float32: "Float32Array",
	uint8: "Uint8Array",
	byte: "Uint8Array",
	int8: "Int8Array",
	uint16: "Uint16Array",
	int16: "Int16Array",
	uint32: "Uint32Array",
	int32: "Int32Array",
	rune: "Int32Array",
};

export function typedArrayConstructorForElem(elemType) {
	if (!elemType) return null;
	const name = elemType.kind === "basic" ? elemType.name : null;
	return name ? (TYPED_ARRAY_CONSTRUCTORS[name] ?? null) : null;
}

export function isTypedArraySlice(type) {
	if (!type) return false;
	const base = type.kind === "named" ? type.underlying : type;
	if (base?.kind !== "slice") return false;
	return typedArrayConstructorForElem(base.elem) !== null;
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
export function isAny(t) {
	return t?.kind === "basic" && t.name === "any";
}
export function isNil(t) {
	return t?.kind === "basic" && t.name === "nil";
}
export function isVoid(t) {
	return t?.kind === "basic" && t.name === "void";
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
		case "typeParam":
			return t.name;
		case "generic":
			return t.name || `generic(${typeStr(t.underlying)})`;
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
