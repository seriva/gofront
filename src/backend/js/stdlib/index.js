// CodeGen stdlib call generation — installed as a mixin on CodeGen.prototype.
// One file per Go package under ./stdlib/. This index merges them.

import { fmtMethods } from "./fmt.js";
import { sharedMethods } from "./shared.js";
import { simdMethods } from "./simd.js";
import { testingMethods } from "./testing.js";

/** @typedef {import('../index.js').CodeGen} CodeGen */

// Stdlib namespace → handler method name. Used by _genStdlibCall to dispatch
// dynamically without creating static call edges.
const STDLIB_METHOD_MAP = {
	fmt: "_genFmt",
	testing: "_genTesting",
	shared: "_genShared",
	simd: "_genSimd",
};

const dispatchMethods = {
	typeComment(typeNode) {
		if (!typeNode) return "unknown";
		switch (typeNode.kind) {
			case "TypeName":
				return typeNode.name;
			case "SliceType":
				return `[]${this.typeComment(typeNode.elem)}`;
			case "MapType":
				return `map[${this.typeComment(typeNode.key)}]${this.typeComment(typeNode.value)}`;
			default:
				return typeNode.kind;
		}
	},

	// Dispatch table for stdlib namespace calls (pkg.Func → inline JS).
	// Returns the generated JS string, or undefined if not handled.
	_genStdlibCall(ns, fn, expr) {
		const method = STDLIB_METHOD_MAP[ns];
		if (!method) return undefined;
		// A member written in Go (fmt.Println) is an ordinary call of its
		// mangled name.
		if (expr.func?._stdName) return undefined;
		// Stdlib shims take raw values; only fmt uses the interface box
		// of a named value (Error() dispatch).
		const isNamespace = expr.func?.expr?._type?.kind === "namespace";
		if (isNamespace && ns !== "fmt") {
			for (const e of expr.args) if (e) e._noNamedBox = true;
		}
		const a = () => expr.args.map((e) => this.genExpr(e));
		const res = this[method](fn, a, expr);
		if (res === undefined && isNamespace && ns !== "fmt") {
			for (const e of expr.args) if (e) delete e._noNamedBox;
		}
		return res;
	},
};

/** @type {ThisType<CodeGen>} */
export const stdlibGenMethods = {
	...fmtMethods,
	...sharedMethods,
	...simdMethods,
	...testingMethods,
	...dispatchMethods,
};
