// CodeGen stdlib call generation — installed as a mixin on CodeGen.prototype.
// One file per Go package under ./stdlib/. This index merges them.

import { binaryMethods } from "./binary.js";
import { builderMethods } from "./builder.js";
import { randMethods } from "./cryptorand.js";
import { errorsMethods } from "./errors.js";
import { fmtMethods } from "./fmt.js";
import { gomMethods } from "./gom.js";
import { jsonMethods } from "./json.js";
import { mathMethods } from "./math.js";
import { osMethods } from "./os.js";
import { regexpMethods } from "./regexp.js";
import { sharedMethods } from "./shared.js";
import { simdMethods } from "./simd.js";
import { strconvMethods } from "./strconv.js";
import { testingMethods } from "./testing.js";
import { timeMethods } from "./time.js";
import { unicodeMethods } from "./unicode.js";

/** @typedef {import('../index.js').CodeGen} CodeGen */

// Stdlib namespace → handler method name. Used by _genStdlibCall to dispatch
// dynamically without creating static call edges.
const STDLIB_METHOD_MAP = {
	fmt: "_genFmt",
	strconv: "_genStrconv",
	math: "_genMath",
	unicode: "_genUnicode",
	os: "_genOs",
	errors: "_genErrors",
	time: "_genTime",
	regexp: "_genRegexp",
	rand: "_genRand",
	testing: "_genTesting",
	shared: "_genShared",
	binary: "_genBinary",
	json: "_genJson",
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
		if (ns === "gom") return this._genGom(fn, expr);
		const method = STDLIB_METHOD_MAP[ns];
		if (!method) return undefined;
		// Stdlib shims take raw values; only fmt and errors use the interface box
		// of a named value (Error() dispatch, error comparisons).
		const isNamespace = expr.func?.expr?._type?.kind === "namespace";
		if (isNamespace && ns !== "fmt" && ns !== "errors") {
			for (const e of expr.args) if (e) e._noNamedBox = true;
		}
		const a = () => expr.args.map((e) => this.genExpr(e));
		const res = this[method](fn, a, expr);
		if (res === undefined && isNamespace && ns !== "fmt" && ns !== "errors") {
			for (const e of expr.args) if (e) delete e._noNamedBox;
		}
		return res;
	},
};

/** @type {ThisType<CodeGen>} */
export const stdlibGenMethods = {
	...builderMethods,
	...errorsMethods,
	...fmtMethods,
	...gomMethods,
	...mathMethods,
	...osMethods,
	...randMethods,
	...regexpMethods,
	...sharedMethods,
	...simdMethods,
	...strconvMethods,
	...timeMethods,
	...unicodeMethods,
	...testingMethods,
	...binaryMethods,
	...jsonMethods,
	...dispatchMethods,
};
