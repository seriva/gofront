// src/lower/errors-as.js
// errors.As as generated Go source.
//
// `errors.As(err, &x)` stores through a pointer whose type only the checker
// knows.  Each call site gets a function generated for its static target
// type; it walks the error tree like the real package and honours custom
// `As(any) bool` methods.  The functions are ordinary Go, parsed and checked
// as part of the package's generated file (src/link/stdlib.js), so both
// backends compile the same code.

import { mentionsTypeParam, TypeSpeller, walkNodes } from "./gen-types.js";

const ERRORS_PATH = "errors";
const NOT_POINTER =
	"errors.As: second argument must be a non-nil pointer to a type that implements error or to any interface type";

// The names the file imports `errors` as.
function errorsAliases(program) {
	const aliases = new Set();
	for (const imp of program.imports ?? [])
		for (const spec of imp.imports)
			if (spec.path === ERRORS_PATH && spec.alias !== "_")
				aliases.add(spec.alias ?? "errors");
	return aliases;
}

const isAsRef = (node, aliases) =>
	node.kind === "SelectorExpr" &&
	node.expr?.kind === "Ident" &&
	aliases.has(node.expr.name) &&
	node.field === "As";

const isAsCall = (node, aliases) =>
	node.kind === "CallExpr" && isAsRef(node.func, aliases);

// Marks `call` to call the generated function `name`.  The function takes the
// typed pointer: the target is not boxed into an interface the way
// errors.As's `any` parameter asked.
function markCall(call, name) {
	call.func._genEntry = name;
	const arg = call.args[1];
	arg._ifaceBox = undefined;
	arg._ifaceSrc = undefined;
	arg._ifaceNamedType = undefined;
	arg._ifacePtrFields = undefined;
}

// One function per distinct target type; `tparams` ("[T any]") makes it the
// shared function for targets that are a type parameter.
function asFunction(name, target, tparams = "") {
	return `func ${name}${tparams}(err error, target *${target}) bool {
	if target == nil {
		panic("errors: target must be a non-nil pointer")
	}
	for err != nil {
		if v, ok := err.(${target}); ok {
			*target = v
			return true
		}
		if a, ok := err.(interface{ As(any) bool }); ok && a.As(target) {
			return true
		}
		switch u := err.(type) {
		case interface{ Unwrap() error }:
			err = u.Unwrap()
		case interface{ Unwrap() []error }:
			for _, e := range u.Unwrap() {
				if e != nil && ${name}${tparams ? "[T]" : ""}(e, target) {
					return true
				}
			}
			return false
		default:
			return false
		}
	}
	return false
}`;
}

// The `errors.As` calls of the programs, and a diagnostic for each use of
// errors.As that is not a call.
function findSites(programs) {
	const sites = [];
	const diagnostics = [];
	for (const program of programs) {
		const aliases = errorsAliases(program);
		if (aliases.size === 0) continue;
		const callees = new Set();
		const refs = [];
		walkNodes(program.decls, (node) => {
			if (isAsCall(node, aliases)) {
				sites.push({ call: node, program });
				callees.add(node.func);
			} else if (isAsRef(node, aliases)) {
				refs.push(node);
			}
		});
		for (const node of refs)
			if (!callees.has(node))
				diagnostics.push({
					program,
					node: node.expr,
					message: "errors.As cannot be used as a value",
					hint: "call errors.As directly",
				});
	}
	return { sites, diagnostics };
}

// What a call's target type allows: { base } for a target to generate for, or
// { message, hint } for one the generator rejects.
function classifyTarget(call) {
	const argType = call.args[1]?._type;
	if (argType?.kind !== "pointer") return { message: NOT_POINTER };
	const base = argType.base;
	if (base?.kind === "interface" && !base.name && base.methods?.size > 0)
		return {
			message:
				"errors.As with a target of an anonymous interface type is not yet available",
			hint: "declare a named interface type for the target",
		};
	if (base?.kind !== "typeParam" && mentionsTypeParam(base))
		return {
			message:
				"errors.As with a target that mentions a type parameter is not yet available",
			hint: "use a target that is a type parameter itself, or a concrete type",
		};
	return { base };
}

// The import paths of the package qualifiers the generated code spells.
function importsFor(programs, qualifiers) {
	const importPaths = new Map();
	for (const p of programs)
		for (const imp of p.imports ?? [])
			for (const spec of imp.imports)
				importPaths.set(spec.alias ?? spec.path.split("/").pop(), spec.path);
	return [...qualifiers].map((qn) => importPaths.get(qn)).filter(Boolean);
}

// Generates the `errors.As` functions for a package's call sites.  Returns
// null when it has none; otherwise { body, imports, diagnostics, link } and
// marks each call's SelectorExpr with `_genEntry`.
export function generateErrorsAs(programs, _checker, pkgName) {
	const { sites, diagnostics } = findSites(programs);
	if (sites.length + diagnostics.length === 0) return null;
	const qualifiers = new Set();
	const speller = new TypeSpeller(pkgName, qualifiers, programs);
	const prefix = `gfe_${String(pkgName).replace(/[^A-Za-z0-9_]/g, "_")}_as_`;
	const names = new Map(); // spelled target -> function name
	const out = [];
	const sharedSites = []; // targets that are a type parameter
	for (const { call, program } of sites) {
		const { base, message, hint } = classifyTarget(call);
		let target;
		try {
			if (base?.kind === "typeParam") sharedSites.push(call);
			else if (base) target = speller.spell(base);
		} catch (e) {
			diagnostics.push({
				program,
				node: call.func.expr,
				message: `errors.As: ${e.message}`,
			});
			continue;
		}
		if (!base) {
			diagnostics.push({ program, node: call.func.expr, message, hint });
			continue;
		}
		if (target === undefined) continue;
		if (!names.has(target)) {
			names.set(target, `${prefix}${names.size}`);
			out.push(asFunction(names.get(target), target));
		}
		markCall(call, names.get(target));
	}
	const sharedName = `${prefix}t`;
	if (sharedSites.length > 0) out.push(asFunction(sharedName, "T", "[T any]"));
	for (const call of sharedSites) markCall(call, sharedName);
	// The shared function is generic: once it is checked, its call sites take
	// the type arguments the checker would have inferred.
	const link = (chk) => {
		const generic = chk.globals.symbols.get(sharedName);
		for (const call of sharedSites) {
			const typeArgs = [call.args[1]._type.base];
			for (const n of [call, call.func]) {
				n._typeArgs = typeArgs;
				n._genericFnType = generic;
			}
		}
	};
	return {
		body: out.join("\n\n"),
		imports: importsFor(programs, qualifiers),
		diagnostics,
		link,
	};
}
