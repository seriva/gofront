// test/unit/compiler/assign-order.test.js
// Unit tests for the shared left-hand operand rule.

import assert from "node:assert";
import { Lexer } from "../../../src/lexer/lexer.js";
import { lhsOperandBinds } from "../../../src/lower/index.js";
import { Parser } from "../../../src/parser/index.js";
import { TypeChecker } from "../../../src/typechecker/index.js";
import { test } from "../helpers.js";

function firstAssign(body) {
	const source = `package main\n\ntype A struct{ A [2]int }\n\nfunc f() int { return 1 }\n\nfunc main() {\n${body}\n}\n`;
	const tokens = new Lexer(source, "test.go").tokenize();
	const ast = new Parser(tokens, "test.go", source).parse();
	new TypeChecker().check(ast);
	const main = ast.decls.find((d) => d.name === "main");
	const stmts = main.body.stmts ?? main.body.body ?? main.body;
	return stmts.filter((s) => s.kind === "AssignStmt" && s.op === "=").at(-1);
}

const isConst = (n) => n.kind === "BasicLit" || n._type?.kind === "untyped";
const isAggregate = (n) =>
	n._type?.kind === "struct" ||
	n._type?.kind === "array" ||
	n._type?.underlying?.kind === "struct";

function binds(body, opts = {}) {
	const stmt = firstAssign(body);
	return lhsOperandBinds(stmt.lhs, stmt.rhs, { isConst, isAggregate, ...opts });
}

const slotNames = (b) => b.map(({ node, key }) => `${node.kind}.${key}`);

test("assign-order: i, xs[i] = 1, 5 binds the index target's index", () => {
	const b = binds("i := 0\nxs := []int{0, 0}\ni, xs[i] = 1, 5");
	assert.deepStrictEqual(slotNames(b), ["IndexExpr.index"]);
	assert.strictEqual(b[0].node.index.name, "i");
});

test("assign-order: p, *p = &b, 0 binds the dereference operand", () => {
	const b = binds("a, b := 1, 2\np := &a\np, *p = &b, 0");
	assert.deepStrictEqual(slotNames(b), ["UnaryExpr.operand"]);
	assert.strictEqual(b[0].node.operand.name, "p");
});

test("assign-order: a call orders every non-constant operand", () => {
	const b = binds("var arr [3]int\ni, x := 0, 0\narr[i], x = f(), 5");
	assert.deepStrictEqual(slotNames(b), ["IndexExpr.index"]);
});

test("assign-order: callOnly leaves plain variables unbound", () => {
	const b = binds("var arr [3]int\ni, x := 0, 0\narr[i], x = f(), 5", {
		callOnly: true,
	});
	assert.deepStrictEqual(b, []);
});

test("assign-order: a struct base is descended into, not bound", () => {
	const b = binds("ps := []A{{}}\nn, k, x := 0, 0, 0\nps[n].A[k], x = f(), 5");
	const names = b.map(
		({ node, key }) => `${node.kind}.${key}:${node[key].name}`,
	);
	assert.deepStrictEqual(names, [
		"IndexExpr.expr:ps",
		"IndexExpr.index:n",
		"IndexExpr.index:k",
	]);
});
