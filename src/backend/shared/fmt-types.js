// Go's `reflect` spelling of a type used as a type argument (the monomorphiser
// records it for `%T` of a type-parameter operand), shared by the JS and WASM
// backends.

const qualify = (name) =>
	name.split("[")[0].includes(".") ? name : `main.${name}`;

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
export function goTypeName(t, specialized = null) {
	const go = (x) => goTypeName(x, specialized);
	switch (t?.kind) {
		case "basic":
			return t.name === "any" ? "interface {}" : t.name;
		case "untyped":
			return t.base;
		case "TypeName":
		case "Ident":
			if (specialized?.has(t.name)) return qualify(specialized.get(t.name));
			if (t.name === "any") return "interface {}";
			return PREDECLARED.has(t.name) ? t.name : qualify(t.name);
		case "GenericTypeName":
			return qualify(`${t.name}[${t.typeArgs.map(go).join(",")}]`);
		case "named":
			return qualify(instanceName(t, specialized));
		case "interface":
			return t.name ? qualify(t.name) : "interface {}";
		case "pointer":
		case "PointerType":
			return `*${go(t.base)}`;
		case "slice":
		case "SliceType":
			return `[]${go(t.elem)}`;
		case "array":
		case "ArrayType":
			return `[${t.size ?? 0}]${go(t.elem)}`;
		case "map":
		case "MapType":
			return `map[${go(t.key)}]${go(t.value)}`;
		default:
			return "interface {}";
	}
}

// `Box[int]` for a generic instance: the checker's type arguments on JS, the
// spelling the monomorphiser recorded on WASM.
function instanceName(t, specialized = null) {
	if (t._goName) return t._goName;
	if (!t.typeArgs?.length) return t.name ?? "";
	return `${t.name}[${t.typeArgs.map((a) => goTypeName(a, specialized)).join(",")}]`;
}
