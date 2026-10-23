// Prints checker types in the notation of Go's api/*.txt files, so the stdlib
// coverage gate can compare GoFront's declared signatures with Go's
// (runtime/stdlib/manifest.json).  Examples:
//   func(string, int, int) (int64, error)
//   func[$0 comparable](...$0) $0
//   interface { Len, Less, Swap }
// Types of the package being printed are unqualified (`Duration`), others
// keep their package (`io.Writer`); type parameters are `$0`, `$1`, … in
// declaration order; `any` is `interface{}` and `void` results are omitted.

const IDEAL = {
	int: "ideal-int",
	float64: "ideal-float",
	string: "ideal-string",
	bool: "ideal-bool",
	complex128: "ideal-complex",
	int32: "ideal-char",
	rune: "ideal-char",
};

// `pkg` is the package's identifier (`time`, `rand`); `tparams` maps type
// parameter names to their `$n` names.
function typeString(t, pkg, tparams) {
	if (!t) return "?";
	switch (t.kind) {
		case "basic":
			return t.name === "any" ? "interface{}" : t.name;
		case "untyped":
			return IDEAL[t.base] ?? `ideal-${t.base}`;
		case "typeParam":
			return tparams.get(t.name) ?? t.name;
		case "slice":
			return `[]${typeString(t.elem, pkg, tparams)}`;
		case "array":
			return `[${t.size}]${typeString(t.elem, pkg, tparams)}`;
		case "pointer":
			return `*${typeString(t.base, pkg, tparams)}`;
		case "map":
			return `map[${typeString(t.key, pkg, tparams)}]${typeString(t.value, pkg, tparams)}`;
		case "func":
			return `func${funcTail(t, pkg, tparams)}`;
		case "generic":
			return genericString(t, pkg, tparams);
		case "TypeName": // an unresolved constraint node (`Ordered`, `any`)
			return tparams.get(t.name) ?? (t.name === "any" ? "interface{}" : t.name);
		// Inline constraint nodes: `~[]E`, `~int | ~string`.
		case "UnionConstraint":
			return `interface{ ${t.terms
				.map((x) => (x.approx ? "~" : "") + typeString(x.type, pkg, tparams))
				.join(" | ")} }`;
		case "SliceType":
			return `[]${typeString(t.elem, pkg, tparams)}`;
		case "PointerType":
			return `*${typeString(t.base, pkg, tparams)}`;
		case "MapType":
			return `map[${typeString(t.key, pkg, tparams)}]${typeString(t.value, pkg, tparams)}`;
		case "GenericTypeName":
			return `${qualify(t.name, pkg)}${typeArgList(t.typeArgs, pkg, tparams)}`;
		default:
			if (t.name)
				return `${qualify(t.name, pkg)}${typeArgList(t.typeArgs, pkg, tparams)}`;
			return t.kind === "struct" ? "struct" : "interface{}";
	}
}

const qualify = (name, pkg) =>
	name.startsWith(`${pkg}.`) ? name.slice(pkg.length + 1) : name;

// `[int, $0]` of an instantiated generic type, or "".
const typeArgList = (args, pkg, tparams) =>
	args?.length > 0
		? `[${args.map((a) => typeString(a, pkg, tparams)).join(", ")}]`
		: "";

// `(params) results` of a func type.
function funcTail(t, pkg, tparams) {
	const params = (t.params ?? []).map(
		(p, i, all) =>
			(t.variadic && i === all.length - 1 ? "..." : "") +
			typeString(p, pkg, tparams),
	);
	// Multiple results of a Go-source func are one `tuple`.
	const results = (t.returns ?? [])
		.flatMap((r) => (r.kind === "tuple" ? r.types : [r]))
		.filter((r) => !(r.kind === "basic" && r.name === "void"))
		.map((r) => typeString(r, pkg, tparams));
	const tail =
		results.length === 0
			? ""
			: results.length === 1
				? ` ${results[0]}`
				: ` (${results.join(", ")})`;
	return `(${params.join(", ")})${tail}`;
}

// `[$0 C, $1 D]`, extending `tparams` with the new names.
function typeParamList(list, pkg, tparams) {
	const inner = new Map(tparams);
	for (const tp of list) inner.set(tp.name, `$${inner.size}`);
	const decl = list.map(
		(tp) =>
			`${inner.get(tp.name)} ${typeString(tp.constraint ?? { kind: "basic", name: "any" }, pkg, inner)}`,
	);
	return { text: `[${decl.join(", ")}]`, inner };
}

function genericString(t, pkg, tparams) {
	const { text, inner } = typeParamList(t.typeParams, pkg, tparams);
	return `func${text}${funcTail(t.underlying, pkg, inner)}`;
}

// The definition of a named type, as in `type T <definition>`.
function typeDefinition(t, pkg) {
	const gen = t._generic?.typeParams;
	const { text, inner } = gen
		? typeParamList(gen, pkg, new Map())
		: { text: "", inner: new Map() };
	const u = t.kind === "named" ? t.underlying : t;
	let def;
	if (u?.kind === "struct") def = "struct";
	else if (u?.kind === "interface") {
		const names = [...(u.methods?.keys() ?? [])].sort();
		def =
			names.length > 0 ? `interface { ${names.join(", ")} }` : "interface {}";
	} else def = typeString(u, pkg, inner);
	return text ? `${text} ${def}` : def;
}

// The manifest signature of a member of kind `kind` whose checker type is
// `t`, in package identifier `pkg`: the func signature for func/method, the
// definition for type, the type for var/const/field.  `owner` is the named
// type a method or field belongs to; its type parameters are `$0`, `$1`, ….
export function goSignature(kind, t, pkg, owner = null) {
	if (kind === "type") return typeDefinition(t, pkg);
	const tparams = new Map(
		(owner?._generic?.typeParams ?? []).map((tp, i) => [tp.name, `$${i}`]),
	);
	return typeString(t, pkg, tparams);
}
