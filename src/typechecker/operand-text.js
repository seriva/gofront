// Source-like text of an expression for diagnostics ("cannot use y (variable
// of type float64) as int value"), spelled as `go/types` does (`ExprString`):
// a composite literal is `T{…}` (`T{}` when empty), a function literal
// `(func() literal)`. A node kind with no printer falls back to "expression".

// ── Type nodes ───────────────────────────────────────────────

const joined = (nodes, print) => (nodes ?? []).map(print).join(", ");

// `a, b int` for consecutive parameters that share one type node (the parser
// gives `a, b int` two params with the same `type` object); an unnamed
// parameter (`_`) prints as its type alone.
function paramsText(params) {
	const groups = [];
	for (const p of params ?? []) {
		const last = groups.at(-1);
		if (last && last.type === p.type && last.variadic === p.variadic)
			last.names.push(p.name);
		else groups.push({ names: [p.name], type: p.type, variadic: p.variadic });
	}
	return groups
		.map((g) => {
			const type = `${g.variadic ? "..." : ""}${typeNodeText(g.type)}`;
			return g.names.length === 1 && g.names[0] === "_"
				? type
				: `${g.names.join(", ")} ${type}`;
		})
		.join(", ");
}

// ` string` / ` (int, error)` / ` (n int, err error)`: a result, with its
// leading space, or "" when there is none.
function resultText(returnType) {
	if (!returnType) return "";
	if (returnType._namedReturns)
		return ` (${returnType._namedReturns.map((r) => (r.name ? `${r.name} ${typeNodeText(r.type)}` : typeNodeText(r.type))).join(", ")})`;
	if (returnType.kind === "TupleType")
		return ` (${joined(returnType.types, typeNodeText)})`;
	return ` ${typeNodeText(returnType)}`;
}

function structText(n) {
	const fields = (n.fields ?? []).map((f) => {
		const type = typeNodeText(f.type);
		const tag = f.tag == null ? "" : ` \`${f.tag}\``;
		return f.embedded || !f.names?.length
			? `${type}${tag}`
			: `${f.names.join(", ")} ${type}${tag}`;
	});
	return `struct{${fields.join("; ")}}`;
}

function unionText(u) {
	return u.terms
		.map((t) => `${t.approx ? "~" : ""}${typeNodeText(t.type)}`)
		.join(" | ");
}

function interfaceText(n) {
	const parts = [
		...(n.embeds ?? []).map(typeNodeText),
		...(n.methods ?? []).map(
			(m) => `${m.name}(${paramsText(m.params)})${resultText(m.returnType)}`,
		),
		...[n.unionConstraint, ...(n.extraUnions ?? [])]
			.filter(Boolean)
			.map(unionText),
	];
	return `interface{${parts.join("; ")}}`;
}

const TYPE_PRINTERS = {
	TypeName: (n) => n.name,
	GenericTypeName: (n) => `${n.name}[${joined(n.typeArgs, typeNodeText)}]`,
	PointerType: (n) => `*${typeNodeText(n.base)}`,
	SliceType: (n) => `[]${typeNodeText(n.elem)}`,
	ArrayType: (n) =>
		`[${n.inferLen ? "..." : exprText(n.size)}]${typeNodeText(n.elem)}`,
	MapType: (n) => `map[${typeNodeText(n.key)}]${typeNodeText(n.value)}`,
	FuncType: (n) => `func(${paramsText(n.params)})${resultText(n.returnType)}`,
	StructType: structText,
	InterfaceType: interfaceText,
	UnionConstraint: unionText,
	TupleType: (n) => `(${joined(n.types, typeNodeText)})`,
};

// The text of a type as written in the source (`[]int`, `struct{X int}`). A
// type position may also hold an expression (`P{}`'s `P`, `pkg.T`, `Box[int]`).
export function typeNodeText(node) {
	return exprText(node);
}

// ── Expressions ──────────────────────────────────────────────

function litText(node) {
	switch (node.litKind) {
		case "STRING":
			return JSON.stringify(node.value);
		case "NIL":
			return "nil";
		default:
			return String(node.value);
	}
}

// `x[a:b]`, `x[:]`, `x[a:b:c]`: the parts that are present.
function sliceText(n) {
	const part = (e) => (e ? exprText(e) : "");
	const max = n.max ? `:${exprText(n.max)}` : "";
	return `${exprText(n.expr)}[${part(n.low)}:${part(n.high)}${max}]`;
}

// `T{…}`, or `T{}` without elements; an elided type prints as `{…}`.
function compositeText(n) {
	const type = n.typeExpr ? typeNodeText(n.typeExpr) : "";
	return `${type}{${n.elems?.length ? "…" : ""}}`;
}

const PRINTERS = {
	Ident: (n) => n.name,
	BasicLit: litText,
	ImagLit: (n) => `${n.value}i`,
	ParenExpr: (n) => `(${exprText(n.expr)})`,
	SelectorExpr: (n) => `${exprText(n.expr)}.${n.field}`,
	UnaryExpr: (n) => `${n.op}${exprText(n.operand)}`,
	BinaryExpr: (n) => `${exprText(n.left)} ${n.op} ${exprText(n.right)}`,
	CallExpr: (n) =>
		`${exprText(n.func)}(${(n.args ?? []).map(exprText).join(", ")})`,
	IndexExpr: (n) => `${exprText(n.expr)}[${exprText(n.index)}]`,
	SliceExpr: sliceText,
	CompositeLit: compositeText,
	KeyValueExpr: (n) => `${exprText(n.key)}: ${exprText(n.value)}`,
	TypeAssertExpr: (n) => `${exprText(n.expr)}.(${typeNodeText(n.type)})`,
	TypeSwitchExpr: (n) => `${exprText(n.expr)}.(type)`,
	TypeConversion: (n) => `${typeNodeText(n.targetType)}(${exprText(n.expr)})`,
	InstantiationExpr: (n) =>
		`${exprText(n.expr)}[${joined(n.typeArgs, typeNodeText)}]`,
	FuncLit: (n) =>
		`(func(${paramsText(n.params)})${resultText(n.returnType)} literal)`,
	TypeExpr: (n) => typeNodeText(n.type),
	AwaitExpr: (n) => `await ${exprText(n.expr)}`,
};

export function exprText(node) {
	// A synthetic node (`x += y`, `x++`) carries its statement's spelling.
	if (node?._spelling) return node._spelling;
	const print = node && (PRINTERS[node.kind] ?? TYPE_PRINTERS[node.kind]);
	return print ? print(node) : "expression";
}

// "variable of type float64", "untyped int constant", "value of type float64".
export function operandKind(node, typeName, isUntypedConst) {
	if (isUntypedConst)
		return `untyped ${typeName === "float64" ? "float" : typeName} constant`;
	return node?.kind === "Ident"
		? `variable of type ${typeName}`
		: `value of type ${typeName}`;
}
