// Go's `reflect` spelling of a type used as a type argument (the monomorphiser
// records it for `%T` of a type-parameter operand), shared by the JS and WASM
// backends.

import { displayTypeName } from "../../typechecker/types.js";

const stripHead = (name) => {
	const bracket = name.indexOf("[");
	const head = bracket < 0 ? name : name.slice(0, bracket);
	const tail = bracket < 0 ? "" : name.slice(bracket);
	return [displayTypeName(head), tail];
};

const qualify = (name, pkgName = null) => {
	const [d, tail] = stripHead(name);
	return (d.includes(".") ? d : `${pkgName || "main"}.${d}`) + tail;
};

const unqualify = (name) => {
	const [d, tail] = stripHead(name);
	return d + tail;
};

const PREDECLARED = new Set([
	"bool",
	"string",
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
	"float32",
	"float64",
	"complex64",
	"complex128",
	"byte",
	"rune",
	"error",
]);

/**
 * Go's `reflect` spelling of a type used as a type argument: `int`,
 * `main.Foo`, `[]main.Foo`.  Takes checker types and parsed type nodes;
 * `specialized` maps the names of monomorphised instances to their spelling.
 * @param {any} t
 * @param {Map<string, string>} [specialized]
 * @returns {string}
 */
export function goTypeName(t, specialized = null, qualifyNames = true) {
	const go = (x) => goTypeName(x, specialized, qualifyNames);
	const q = (name, pkgName = null) =>
		qualifyNames ? qualify(name, pkgName) : unqualify(name);
	switch (t?.kind) {
		case "basic":
			return t.name === "any" ? "interface {}" : t.name;
		case "untyped":
			return t.base;
		case "TypeName":
		case "Ident":
			if (specialized?.has(t.name))
				return q(specialized.get(t.name), t._pkgName);
			if (t.name === "any") return "interface {}";
			return PREDECLARED.has(t.name) ? t.name : q(t.name, t._pkgName);
		case "GenericTypeName":
			return q(`${t.name}[${t.typeArgs.map(go).join(",")}]`, t._pkgName);
		case "named":
			return q(instanceName(t, specialized, qualifyNames), t._pkgName);
		case "interface":
			return t.name ? q(t.name, t._pkgName) : "interface {}";
		case "struct":
		case "StructType": {
			if (t.name) return q(t.name, t._pkgName);
			// `struct { X int; main.P }`: an embedded field is just its type.
			const fields = [];
			for (const f of t._structFields ?? t.fields ?? []) {
				if (f.embedded) fields.push(go(f.type));
				else for (const n of f.names ?? []) fields.push(`${n} ${go(f.type)}`);
			}
			return fields.length ? `struct { ${fields.join("; ")} }` : "struct {}";
		}
		case "pointer":
		case "PointerType":
			return `*${go(t.base)}`;
		case "slice":
		case "SliceType":
			return `[]${go(t.elem)}`;
		case "array":
		case "ArrayType":
			// A parsed array type carries its length as a literal node.
			return `[${typeof t.size === "object" ? (t.size?.value ?? 0) : (t.size ?? 0)}]${go(t.elem)}`;
		case "map":
		case "MapType":
			return `map[${go(t.key)}]${go(t.value)}`;
		case "func": {
			// A func without results is `func()`, not `func() void`.
			const rets = (t.returns ?? [])
				.filter((r) => !(r?.kind === "basic" && r.name === "void"))
				.map(go);
			const ret =
				rets.length === 0
					? ""
					: rets.length === 1
						? ` ${rets[0]}`
						: ` (${rets.join(", ")})`;
			return `func(${(t.params ?? []).map(go).join(", ")})${ret}`;
		}
		case "FuncType": {
			// A parsed func type: parameters and the result as written.
			const rt = t.returnType;
			const rets = !rt ? [] : rt.kind === "TupleType" ? rt.types : [rt];
			const ret =
				rets.length === 0
					? ""
					: rets.length === 1
						? ` ${go(rets[0])}`
						: ` (${rets.map(go).join(", ")})`;
			const params = (t.params ?? []).map((p) =>
				p.variadic ? `...${go(p.type)}` : go(p.type),
			);
			return `func(${params.join(", ")})${ret}`;
		}
		default:
			return "interface {}";
	}
}

// `Box[int]` for a generic instance: the checker's type arguments on JS, the
// spelling the monomorphiser recorded on WASM.
function instanceName(t, specialized = null, qualifyNames = true) {
	if (!qualifyNames && t._instanceKey) return t._instanceKey;
	if (t._goName) return t._goName;
	if (!t.typeArgs?.length) return t.name ?? "";
	return `${t.name}[${t.typeArgs.map((a) => goTypeName(a, specialized, qualifyNames)).join(",")}]`;
}
