// The case grid of the checker differential fuzzer (checkfuzz.js).
//
// Every case is one small Go program whose only question is "does the type
// checker accept this?". The grid crosses a list of operand kinds with one
// template per rule of the Go spec, so a rule is probed on every kind and not
// only on the ones a bug report happened to name.
//
// A case is { key, src, pkgs? }. `key` is `<section>:<template>:<kinds>` and
// names the case in the baseline file; `pkgs` maps an import path to the
// source of a one-file package the program imports.

// ── Operand kinds ────────────────────────────────────────────

const typed = (id, type) => ({ id, type });
const tparam = (id, constraint) => ({ id, constraint });
const untyped = (id, lit) => ({ id, lit });

export const TYPED = [
	typed("bool", "bool"),
	typed("int", "int"),
	typed("int8", "int8"),
	typed("uint", "uint"),
	typed("float32", "float32"),
	typed("float64", "float64"),
	typed("complex64", "complex64"),
	typed("complex128", "complex128"),
	typed("string", "string"),
	typed("MI", "MI"),
	typed("MS", "MS"),
	typed("MB", "MB"),
	typed("MI2", "MI2"),
	typed("MS2", "MS2"),
	typed("ptr", "*int"),
	typed("slice", "[]int"),
	typed("array", "[2]int"),
	typed("map", "map[string]int"),
	typed("func", "func()"),
	typed("struct", "struct{ X int }"),
	typed("P", "P"),
	typed("PS", "PS"),
	typed("any", "any"),
	typed("I", "I"),
	typed("E", "E"),
	typed("I2", "I2"),
	typed("error", "error"),
];

export const TPARAMS = [
	tparam("Tany", "any"),
	tparam("Tcomparable", "comparable"),
	tparam("Tnum", "~int | ~float64"),
];

export const UNTYPED = [
	untyped("1", "1"),
	untyped("1.5", "1.5"),
	untyped("1i", "1i"),
	untyped("1+0i", "(1 + 0i)"),
	untyped("str", '"a"'),
	untyped("true", "true"),
	untyped("rune", "'a'"),
	untyped("nil", "nil"),
	untyped("1e40", "1e40"),
	untyped("1e400", "1e400"),
];

// Kinds a variable can have, and every kind an operand can have.
const VARS = [...TYPED, ...TPARAMS];
const ALL = [...VARS, ...UNTYPED];

// Declared by every program; the kinds above name these types. `MI2`, `MS2`
// and `I2` are defined over a defined type: their underlying type is two
// declarations away.
const PRELUDE = [
	"type MI int",
	"type MS string",
	"type MB bool",
	"type MI2 MI",
	"type MS2 MS",
	"type P struct{ X int }",
	"type PS struct{ S []int }",
	"type I interface{ M() }",
	"type E interface{}",
	"type I2 I",
];

// ── Rendering ────────────────────────────────────────────────

// The case body runs in `f`, which `main` calls, so the backends emit it. A
// type-parameter kind makes `f` generic and `main` instantiates it with int.
function render(c) {
	const lines = ["package main", ""];
	for (const i of c.imports ?? []) lines.push(`import ${i}`);
	if (c.imports?.length) lines.push("");
	lines.push(...PRELUDE, "", ...(c.decls ?? []), "");
	const tparams = c.tparams ?? [];
	const generic = tparams.length ? `[${tparams.join(", ")}]` : "";
	const targs = c.targs ?? tparams.map(() => "int");
	const inst = tparams.length ? `[${targs.join(", ")}]` : "";
	lines.push(
		`func f${generic}(${(c.params ?? []).join(", ")}) {`,
		...[...(c.locals ?? []), ...c.body].map((l) => `\t${l}`),
		"}",
		"",
		"func main() {",
		`\tf${inst}(${(c.args ?? []).join(", ")})`,
		"}",
		"",
	);
	return lines.join("\n");
}

// The type of `kind` in `slot` ("a" or "b"): a type-parameter kind declares
// its own type parameter, named after the slot.
function typeIn(kind, slot) {
	if (!kind.constraint) return { type: kind.type, tparams: [] };
	const name = `T${slot.toUpperCase()}`;
	return { type: name, tparams: [`${name} ${kind.constraint}`] };
}

// An operand of `kind` in `slot`: the expression naming it and what the
// program declares for it. A typed kind is a local variable of type
// `wrap(type)`; an untyped kind is its literal.
function operand(kind, slot, wrap = (t) => t, given = null) {
	if (kind.lit) return { expr: kind.lit, tparams: [], locals: [] };
	const t = given ?? typeIn(kind, slot);
	return {
		expr: slot,
		type: t.type,
		tparams: given ? [] : t.tparams,
		locals: [`var ${slot} ${wrap(t.type)}`, `_ = ${slot}`],
	};
}

// Operands `a` and `b`. Two operands of the same type-parameter kind share
// one type parameter, as two operands of the same named type share a type.
function operands(l, r, wrap) {
	const a = operand(l, "a", wrap);
	const shared = l === r && l.constraint ? { type: a.type } : null;
	const b = operand(r, "b", wrap, shared);
	return {
		a,
		b,
		tparams: [...a.tparams, ...b.tparams],
		locals: [...a.locals, ...b.locals],
	};
}

// `T(x)`: Go needs parentheses around a type that starts with `*` or `func`,
// or that ends in a function type without a result (`[]func()`).
const convert = (type, expr) =>
	/^(\*|func\b)|\bfunc\(\)$/.test(type)
		? `(${type})(${expr})`
		: `${type}(${expr})`;

// ── Sections: one per rule of the spec ───────────────────────

// One operator per class: `+` (numeric, string), `-` (numeric), `%` and `&`
// (integer), `==` (comparable), `<` (ordered), `&&` (boolean), `<<` (shift).
const BINARY_OPS = ["+", "-", "%", "&", "==", "<", "&&", "<<"];

function* binaryCases() {
	for (const op of BINARY_OPS)
		for (const l of ALL)
			for (const r of ALL) {
				const o = operands(l, r);
				yield {
					key: `binary:${op}:${l.id},${r.id}`,
					src: render({ ...o, body: [`_ = ${o.a.expr} ${op} ${o.b.expr}`] }),
				};
			}
}

function* unaryCases() {
	for (const op of ["+", "-", "!", "^"])
		for (const k of ALL) {
			const a = operand(k, "a");
			yield {
				key: `unary:${op}:${k.id}`,
				src: render({ ...a, body: [`_ = ${op}${a.expr}`] }),
			};
		}
}

function* opAssignCases() {
	for (const op of ["+=", "%=", "<<="])
		for (const l of VARS)
			for (const r of ALL) {
				const o = operands(l, r);
				yield {
					key: `opassign:${op}:${l.id},${r.id}`,
					src: render({ ...o, body: [`a ${op} ${o.b.expr}`] }),
				};
			}
}

function* incDecCases() {
	for (const op of ["++", "--"])
		for (const k of VARS)
			yield {
				key: `incdec:${op}:${k.id}`,
				src: render({ ...operand(k, "a"), body: [`a${op}`] }),
			};
}

// A shift whose operand is an untyped constant takes the type of its
// context: constant shifts and shifts by a variable follow different rules.
function* shiftCases() {
	const counts = [
		["const", "2", []],
		["nonconst", "s", ["var s uint = 1"]],
	];
	for (const [name, count, locals] of counts)
		for (const ctx of VARS)
			for (const c of UNTYPED) {
				const t = typeIn(ctx, "a");
				yield {
					key: `shift:${name}:${ctx.id},${c.id}`,
					src: render({
						tparams: t.tparams,
						locals,
						body: [`var x ${t.type} = ${c.lit} << ${count}`, "_ = x"],
					}),
				};
			}
}

// Element types of composite types must be identical, not merely
// assignable or convertible.
const WRAPPERS = [
	["ptr", (t) => `*${t}`],
	["array", (t) => `[2]${t}`],
	["slice", (t) => `[]${t}`],
];

// `use(targetType, operandExpr)` is the body of a case that moves a value of
// one kind to a target of another: an assignment or a conversion.
function* valueMoveCases(section, use) {
	for (const target of VARS)
		for (const source of ALL) {
			const t = typeIn(target, "a");
			const shared =
				target === source && target.constraint ? { type: t.type } : null;
			const b = operand(source, "b", undefined, shared);
			yield {
				key: `${section}:value:${target.id},${source.id}`,
				src: render({
					tparams: [...t.tparams, ...b.tparams],
					locals: b.locals,
					body: use(t.type, b.expr),
				}),
			};
		}
	for (const [name, wrap] of WRAPPERS)
		for (const target of VARS)
			for (const source of VARS) {
				const t = typeIn(target, "a");
				const shared =
					target === source && target.constraint ? { type: t.type } : null;
				const b = operand(source, "b", wrap, shared);
				yield {
					key: `${section}:${name}:${target.id},${source.id}`,
					src: render({
						tparams: [...t.tparams, ...b.tparams],
						locals: b.locals,
						body: use(wrap(t.type), b.expr),
					}),
				};
			}
}

const assignCases = () =>
	valueMoveCases("assign", (type, expr) => [
		`var t ${type} = ${expr}`,
		"_ = t",
	]);

const convCases = () =>
	valueMoveCases("conv", (type, expr) => [`_ = ${convert(type, expr)}`]);

// A method receiver's base type is a defined type of the package that is
// neither a pointer nor an interface.
const RECEIVERS = [
	["defined-int", "MI"],
	["defined-over-defined", "MI2"],
	["ptr-defined-int", "*MI"],
	["struct", "P"],
	["ptr-struct", "*P"],
	["ptr-ptr-struct", "**P"],
	["iface", "I"],
	["ptr-iface", "*I"],
	["empty-iface", "E"],
	["ptr-type", "PT", "type PT *int"],
	["ptr-ptr-type", "*PT", "type PT *int"],
	["int", "int"],
	["ptr-int", "*int"],
	["error", "error"],
	["any", "any"],
	["alias-unnamed", "AS", "type AS = []int"],
	["alias-defined", "AP", "type AP = P"],
	["ptr-alias-defined", "*AP", "type AP = P"],
	["defined-slice", "DS", "type DS []int"],
	["defined-func", "DF", "type DF func()"],
	["defined-map", "DM", "type DM map[string]int"],
	["generic", "G[T]", "type G[T any] struct{ V T }"],
	["ptr-generic", "*G[T]", "type G[T any] struct{ V T }"],
	["slice-literal", "[]int"],
	["struct-literal", "struct{ X int }"],
	["undefined", "Nope"],
];

function* receiverCases() {
	for (const [id, recv, decl] of RECEIVERS)
		yield {
			key: `recv:decl:${id}`,
			src: render({
				decls: [...(decl ? [decl, ""] : []), `func (r ${recv}) Mx() {}`],
				body: [],
			}),
		};
}

// A switch tag must be comparable and each case is the comparison
// `tag == case`; a switch without a tag compares each case with `true`.
function* switchCases() {
	for (const tag of ALL)
		for (const c of ALL) {
			const o = operands(tag, c);
			yield {
				key: `switch:tag:${tag.id},${c.id}`,
				src: render({
					...o,
					body: [`switch ${o.a.expr} {`, `case ${o.b.expr}:`, "}"],
				}),
			};
		}
	for (const tag of ALL) {
		const a = operand(tag, "a");
		yield {
			key: `switch:empty:${tag.id}`,
			src: render({ ...a, body: [`switch ${a.expr} {`, "}"] }),
		};
	}
	for (const c of ALL) {
		const b = operand(c, "b");
		yield {
			key: `switch:tagless:${c.id}`,
			src: render({ ...b, body: ["switch {", `case ${b.expr}:`, "}"] }),
		};
	}
}

// A range clause accepts a string, array, pointer to array, slice, map,
// integer or iterator function (spec *For statements with range clause*),
// through the core type of a type parameter, and permits one or two iteration
// variables depending on the operand. Channels are left out: GoFront has no
// runtime for them.
const ITER_DECLS = ["type Seq func(func(int) bool)"];
const RANGE_KINDS = [
	typed("ptrarray", "*[2]int"),
	typed("iter0", "func(func() bool)"),
	typed("iter1", "func(func(int) bool)"),
	typed("iter2", "func(func(int, string) bool)"),
	typed("Seq", "Seq"),
	typed("funcnoiter", "func(func(int))"),
	// `inst` is the type argument `main` instantiates the kind with.
	{ ...tparam("Tslice", "~[]int"), inst: "[]int" },
	{ ...tparam("Tstr", "~string"), inst: "string" },
	{ ...tparam("Tint", "~int"), inst: "int" },
	{ ...tparam("Tfloat", "~float64"), inst: "float64" },
	{ ...tparam("Tmixed", "~[]int | ~string"), inst: "string" },
	{
		...tparam("Titer1", "~func(func(int) bool)"),
		inst: "func(func(int) bool)",
	},
	{ ...tparam("Tfuncnoiter", "~func(func(int))"), inst: "func(func(int))" },
	untyped("1<<63", "1 << 63"),
];

const RANGE_FORMS = [
	["none", (x) => [`for range ${x} {`, "}"]],
	["key", (x) => [`for i := range ${x} {`, "\t_ = i", "}"]],
	["kv", (x) => [`for i, v := range ${x} {`, "\t_, _ = i, v", "}"]],
	["assign", (x) => ["var i any", `for i = range ${x} {`, "}", "_ = i"]],
];

function* rangeCases() {
	for (const [form, body] of RANGE_FORMS)
		for (const k of [...ALL, ...RANGE_KINDS]) {
			const a = operand(k, "a");
			yield {
				key: `range:${form}:${k.id}`,
				src: render({
					...a,
					decls: ITER_DECLS,
					targs: k.constraint ? [k.inst ?? "int"] : undefined,
					body: body(a.expr),
				}),
			};
		}
}

// ── Names: what an identifier refers to ──────────────────────

// A name is a variable, constant, type, function, package or builtin, and
// that decides where it may stand. Each kind of name is tried in each
// position, including names reached through a package and predeclared names
// a declaration shadows.

const SUB_PKG = [
	"package sub",
	"",
	"var V int",
	"",
	"const C = 1",
	"",
	"func Fn() {}",
	"",
	"type T struct{ X int }",
	"",
].join("\n");

// A package-level use keeps the import used whatever the case body does.
const std = (pkg, member) => ({
	imports: [`"${pkg}"`],
	decls: [`var _ = ${pkg}.${member}`],
});
const sub = { imports: ['"./sub"'], decls: ["var _ = sub.V"], sub: true };
const dot = { imports: ['. "./sub"'], decls: ["var _ = V"], sub: true };
const getter = "func (p P) Get() int { return p.X }";

const NAMES = [
	// Declared in the package or the function.
	{ id: "local-var", name: "x", locals: ["var x int", "_ = x"] },
	{ id: "param", name: "p", params: ["p int"], args: ["0"] },
	{ id: "pkg-var", name: "gv", decls: ["var gv int"] },
	{ id: "local-const", name: "c", locals: ["const c = 1"] },
	{ id: "pkg-const", name: "gc", decls: ["const gc = 1"] },
	{ id: "local-type", name: "LT", locals: ["type LT struct{ X int }"] },
	{ id: "pkg-type", name: "P" },
	{ id: "pkg-alias", name: "AP", decls: ["type AP = P"] },
	{ id: "type-param", name: "TA", tparams: ["TA any"] },
	{ id: "func", name: "fn", decls: ["func fn() {}"] },
	{ id: "generic-func", name: "gfn", decls: ["func gfn[T any]() {}"] },
	{ id: "func-var", name: "lf", locals: ["lf := func() {}", "_ = lf"] },
	{ id: "field", name: "pv.X", locals: ["var pv P", "_ = pv"] },
	{
		id: "method-value",
		name: "pv.Get",
		decls: [getter],
		locals: ["var pv P", "_ = pv"],
	},
	{ id: "method-expr", name: "P.Get", decls: [getter] },
	// Predeclared.
	{ id: "builtin", name: "len" },
	{ id: "nil", name: "nil" },
	{ id: "predeclared-const", name: "true" },
	{ id: "predeclared-type", name: "int" },
	// Reached through a package.
	{ id: "package", name: "strings", ...std("strings", "ToUpper") },
	{ id: "std-func", name: "strings.ToUpper", ...std("strings", "ToUpper") },
	{ id: "std-type", name: "strings.Builder", ...std("strings", "ToUpper") },
	{ id: "std-const", name: "math.Pi", ...std("math", "Pi") },
	{ id: "std-var", name: "io.EOF", ...std("io", "EOF") },
	{ id: "qualified-var", name: "sub.V", ...sub },
	{ id: "qualified-const", name: "sub.C", ...sub },
	{ id: "qualified-func", name: "sub.Fn", ...sub },
	{ id: "qualified-type", name: "sub.T", ...sub },
	{ id: "dot-var", name: "V", ...dot },
	{ id: "dot-const", name: "C", ...dot },
	{ id: "dot-func", name: "Fn", ...dot },
	{ id: "dot-type", name: "T", ...dot },
	// Predeclared and imported names a declaration shadows.
	{ id: "shadow-builtin-func", name: "len", decls: ["func len() {}"] },
	{ id: "shadow-builtin-pkg-var", name: "cap", decls: ["var cap int"] },
	{ id: "shadow-builtin-var", name: "len", locals: ["len := 1", "_ = len"] },
	{ id: "shadow-const-var", name: "true", locals: ["true := 1", "_ = true"] },
	{ id: "shadow-nil-var", name: "nil", locals: ["nil := 1", "_ = nil"] },
	{
		id: "shadow-type-var",
		name: "string",
		locals: ["string := 1", "_ = string"],
	},
	{ id: "shadow-type-alias", name: "int32", decls: ["type int32 = string"] },
	{
		id: "shadow-type-defined",
		name: "error",
		decls: ["type error struct{ X int }"],
	},
	{
		id: "shadow-type-local",
		name: "int32",
		locals: ["type int32 struct{ X int }"],
	},
	{ id: "shadow-any", name: "any", decls: ["type any = int"] },
	{
		id: "shadow-package-var",
		name: "strings",
		...std("strings", "ToUpper"),
		locals: ["strings := 1", "_ = strings"],
	},
	{
		id: "shadow-package-type",
		name: "strings",
		...std("strings", "ToUpper"),
		locals: ["type strings struct{ X int }"],
	},
];

const POSITIONS = [
	["value", (n) => [`_ = ${n}`]],
	["assign", (n) => [`${n} = ${n}`]],
	["addr", (n) => [`_ = &${n}`]],
	["incdec", (n) => [`${n}++`]],
	["call", (n) => [`${n}()`]],
	["conv", (n) => [`_ = ${n}(1)`]],
	["type", (n) => [`var v ${n}`, "_ = v"]],
	["lit", (n) => [`_ = ${n}{}`]],
];

function* nameCases() {
	for (const [position, body] of POSITIONS)
		for (const n of NAMES) {
			const c = {
				key: `names:${position}:${n.id}`,
				src: render({ ...n, body: body(n.name) }),
			};
			if (n.sub) c.pkgs = { "./sub": SUB_PKG };
			yield c;
		}
}

// ── The grid ─────────────────────────────────────────────────

const SECTIONS = {
	binary: binaryCases,
	unary: unaryCases,
	opassign: opAssignCases,
	incdec: incDecCases,
	shift: shiftCases,
	assign: assignCases,
	conv: convCases,
	recv: receiverCases,
	switch: switchCases,
	range: rangeCases,
	names: nameCases,
};

export const SECTION_NAMES = Object.keys(SECTIONS);

// Every case of the named sections (all of them by default), in a fixed
// order.
export function gridCases(sections = SECTION_NAMES) {
	const out = [];
	for (const name of sections) {
		const gen = SECTIONS[name];
		if (!gen) throw new Error(`unknown section ${name}`);
		out.push(...gen());
	}
	return out;
}

// `n` cases picked by `seed`, in grid order: the same seed picks the same
// cases.
export function sampleCases(cases, n, seed) {
	if (n >= cases.length) return cases;
	let s = (seed * 2654435761) >>> 0 || 1;
	const next = () => {
		s ^= s << 13;
		s >>>= 0;
		s ^= s >>> 17;
		s ^= s << 5;
		s >>>= 0;
		return s / 4294967296;
	};
	const index = cases.map((_, i) => i);
	for (let i = 0; i < n; i++) {
		const j = i + Math.floor(next() * (index.length - i));
		[index[i], index[j]] = [index[j], index[i]];
	}
	return index
		.slice(0, n)
		.sort((x, y) => x - y)
		.map((i) => cases[i]);
}
