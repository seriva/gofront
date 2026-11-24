// The operand kinds each operator is defined on (Go spec: Arithmetic,
// Comparison and Logical operators, Operators). One table answers "does this
// operator accept an operand of this type" for the binary, logical, shift and
// unary checks, so each of them reports the same rule the same way.

import {
	anyKind,
	SIZED_FLOAT_NAMES,
	SIZED_INT_NAMES,
	underlyingOf,
} from "./types.js";

const INT_NAMES = new Set(SIZED_INT_NAMES);
const FLOAT_NAMES = new Set(SIZED_FLOAT_NAMES);

const set = (...kinds) => new Set(kinds);
const INTEGER = set("integer");
const NUMERIC_COMPLEX = set("integer", "float", "complex");
const ORDERED = set("integer", "float", "string");
const BOOLEAN = set("bool");
// Everything the spec calls comparable by kind; whether a struct or array
// has comparable fields is a property of its fields, not of its kind.
const COMPARABLE_KINDS = set(
	"integer",
	"float",
	"complex",
	"string",
	"bool",
	"pointer",
	"struct",
	"array",
	"interface",
	"chan",
	"namespace",
);

/** Operator → operand kinds it is defined on (binary form). */
export const OPERAND_KINDS = {
	"+": set("integer", "float", "complex", "string"),
	"-": NUMERIC_COMPLEX,
	"*": NUMERIC_COMPLEX,
	"/": NUMERIC_COMPLEX,
	"%": INTEGER,
	"&": INTEGER,
	"|": INTEGER,
	"^": INTEGER,
	"&^": INTEGER,
	"<<": INTEGER,
	">>": INTEGER,
	"<": ORDERED,
	"<=": ORDERED,
	">": ORDERED,
	">=": ORDERED,
	"==": COMPARABLE_KINDS,
	"!=": COMPARABLE_KINDS,
	"&&": BOOLEAN,
	"||": BOOLEAN,
};

/** Operator → operand kinds it is defined on (unary form). */
export const UNARY_OPERAND_KINDS = {
	"+": NUMERIC_COMPLEX,
	"-": NUMERIC_COMPLEX,
	"^": INTEGER,
	"!": BOOLEAN,
};

/**
 * Operand kind of a type: `integer`, `float`, `complex`, `string`, `bool`,
 * `pointer`, `struct`, `array`, `slice`, `map`, `func`, `chan`, `interface`,
 * `namespace` (a `.d.ts` interface or class, compared by reference), `nil`,
 * `typeParam`, or `loose` for a JS-dynamic or recovered type and the
 * kinds the checker models loosely (every operator accepts those).
 * `under` resolves a defined type to its underlying type.
 */
export function operandKindOf(t, under = underlyingOf) {
	if (!t) return "loose";
	if (t.kind === "untyped") {
		if (t.base === "int") return "integer";
		if (t.base === "float64") return "float";
		if (t.base === "complex128") return "complex";
		if (t.base === "string" || t.base === "bool") return t.base;
		return "nil";
	}
	if (t.kind === "typeParam") return "typeParam";
	const ak = anyKind(t);
	if (ak === "go") return "interface";
	if (ak) return "loose";
	const u = under(t);
	if (!u || u._tainted) return "loose";
	switch (u.kind) {
		case "basic":
			return basicKind(u.name);
		case "pointer":
		case "struct":
		case "array":
		case "slice":
		case "map":
		case "func":
		case "chan":
		case "interface":
		case "namespace":
			return u.kind;
		default:
			return "loose";
	}
}

function basicKind(name) {
	if (INT_NAMES.has(name)) return "integer";
	if (FLOAT_NAMES.has(name)) return "float";
	if (name === "complex64" || name === "complex128") return "complex";
	if (name === "string" || name === "bool") return name;
	if (name === "nil") return "nil";
	if (name === "comparable") return "interface";
	return "loose";
}

/**
 * Whether operator `op` is defined on an operand of type `t`. `t` may be an
 * untyped constant (its class decides: `1.5` is a float constant) or a type
 * parameter (every type of its type set must accept the operator). `terms`
 * returns the types of a type parameter's type set (null or empty: none, so
 * no operator but a comparison applies); `under` resolves defined types;
 * `unary` selects the one-operand form (`+x` has no string form).
 */
export function operatorDefined(
	op,
	t,
	{ unary = false, under = underlyingOf, terms = () => null } = {},
) {
	const allowed = (unary ? UNARY_OPERAND_KINDS : OPERAND_KINDS)[op];
	if (!allowed) return true;
	const kind = operandKindOf(t, under);
	if (kind === "loose") return true;
	if (kind === "typeParam") {
		const ts = terms(t);
		return (
			!!ts?.length &&
			ts.every((term) => operatorDefined(op, term, { unary, under, terms }))
		);
	}
	return allowed.has(kind);
}
