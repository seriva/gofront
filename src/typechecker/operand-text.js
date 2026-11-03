// Source-like text of an expression for diagnostics ("cannot use y (variable
// of type float64) as int value"). Only the common shapes are printed in full;
// anything else falls back to "expression".

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

const PRINTERS = {
	Ident: (n) => n.name,
	BasicLit: litText,
	ParenExpr: (n) => `(${exprText(n.expr)})`,
	SelectorExpr: (n) => `${exprText(n.expr)}.${n.field}`,
	UnaryExpr: (n) => `${n.op}${exprText(n.operand)}`,
	BinaryExpr: (n) => `${exprText(n.left)} ${n.op} ${exprText(n.right)}`,
	CallExpr: (n) =>
		`${exprText(n.func)}(${(n.args ?? []).map(exprText).join(", ")})`,
	IndexExpr: (n) => `${exprText(n.expr)}[${exprText(n.index)}]`,
};

export function exprText(node) {
	const print = node && PRINTERS[node.kind];
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
