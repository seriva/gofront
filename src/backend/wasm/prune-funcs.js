// src/backend/was./prune-funcs.js
// Drops function imports and defined functions that no export, element
// segment, global initialiser or start function reaches, and renumbers the function index space to match. Imports
// are registered eagerly because the table is locked before bodies are
// emitted, so most modules declare far more than they call.

const FUNC_REF_OPS = new Set(["call", "return_call", "ref.func"]);

const funcRef = (inst) => inst.funcIndex ?? inst.index ?? 0;

function funcRefsOf(insts, visit) {
	for (const inst of insts ?? []) {
		if (FUNC_REF_OPS.has(inst.op)) visit(funcRef(inst));
	}
}

// Calls `visit` for every function the module reaches without a body: exports,
// element segments, global initialisers and the start function.
function forEachRoot(moduleIR, visit) {
	for (const g of moduleIR.globals ?? []) funcRefsOf(g.init, visit);
	for (const idx of moduleIR.elements ?? []) visit(idx);
	for (const exp of moduleIR.exports ?? []) {
		if (exp.kind === "func") visit(exp.index);
	}
	if (typeof moduleIR.start === "number") visit(moduleIR.start);
}

function remapInst(inst, remap) {
	if (!FUNC_REF_OPS.has(inst.op)) return inst;
	const next = remap[funcRef(inst)];
	return "funcIndex" in inst
		? { ...inst, funcIndex: next }
		: { ...inst, index: next };
}

// Marks every function index reachable from the roots through call bodies.
function reachableFuncs(moduleIR, count, total) {
	const used = new Array(total).fill(false);
	const work = [];
	const mark = (idx) => {
		if (idx < total && !used[idx]) {
			used[idx] = true;
			work.push(idx);
		}
	};
	forEachRoot(moduleIR, mark);
	while (work.length > 0) {
		const idx = work.pop();
		if (idx >= count) funcRefsOf(moduleIR.funcs[idx - count].body, mark);
	}
	return used;
}

function applyRemap(moduleIR, remap) {
	for (const fn of moduleIR.funcs) {
		fn.body = fn.body.map((inst) => remapInst(inst, remap));
	}
	for (const g of moduleIR.globals ?? []) {
		if (g.init) g.init = g.init.map((inst) => remapInst(inst, remap));
	}
	if (moduleIR.elements) {
		moduleIR.elements = moduleIR.elements.map((idx) => remap[idx]);
	}
	for (const exp of moduleIR.exports ?? []) {
		if (exp.kind === "func") exp.index = remap[exp.index];
	}
	if (typeof moduleIR.start === "number") {
		moduleIR.start = remap[moduleIR.start];
	}
}

export function pruneUnusedFuncs(moduleIR) {
	const imports = moduleIR.imports ?? [];
	const funcImports = imports.filter((imp) => imp.kind === "func");
	const count = funcImports.length;
	const total = count + moduleIR.funcs.length;

	const used = reachableFuncs(moduleIR, count, total);
	if (used.every(Boolean)) return;

	const remap = new Array(total);
	let next = 0;
	for (let i = 0; i < total; i++) if (used[i]) remap[i] = next++;

	const dropped = new Set(funcImports.filter((_, i) => !used[i]));
	moduleIR.imports = imports.filter((imp) => !dropped.has(imp));
	moduleIR.funcs = moduleIR.funcs.filter((_, i) => used[count + i]);
	applyRemap(moduleIR, remap);
}
