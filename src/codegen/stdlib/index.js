// CodeGen stdlib call generation — installed as a mixin on CodeGen.prototype.
// One file per Go package under ./stdlib/. This index merges them.

import { builderMethods } from "./builder.js";
import { bytesMethods } from "./bytes.js";
import { errorsMethods } from "./errors.js";
import { fmtMethods } from "./fmt.js";
import { gomMethods } from "./gom.js";
import { htmlMethods } from "./html.js";
import { ioMethods } from "./io.js";
import { mapsMethods } from "./maps.js";
import { mathMethods } from "./math.js";
import { osMethods } from "./os.js";
import { pathMethods } from "./path.js";
import { randMethods } from "./rand.js";
import { regexpMethods } from "./regexp.js";
import { slicesMethods } from "./slices.js";
import { sortMethods } from "./sort.js";
import { strconvMethods } from "./strconv.js";
import { stringsMethods } from "./strings.js";
import { timeMethods } from "./time.js";
import { unicodeMethods } from "./unicode.js";
import { utf8Methods } from "./utf8.js";

// Stdlib namespace → handler method name. Used by _genStdlibCall to dispatch
// dynamically without creating static call edges.
const STDLIB_METHOD_MAP = {
	fmt: "_genFmt",
	strings: "_genStrings",
	bytes: "_genBytes",
	strconv: "_genStrconv",
	sort: "_genSort",
	math: "_genMath",
	unicode: "_genUnicode",
	os: "_genOs",
	errors: "_genErrors",
	time: "_genTime",
	regexp: "_genRegexp",
	slices: "_genSlices",
	maps: "_genMaps",
	html: "_genHtml",
	io: "_genIo",
	rand: "_genRand",
	utf8: "_genUtf8",
	path: "_genPath",
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
		const a = () => expr.args.map((e) => this.genExpr(e));
		if (ns === "gom") return this._genGom(fn, expr);
		const method = STDLIB_METHOD_MAP[ns];
		return method ? this[method](fn, a, expr) : undefined;
	},
};

export const stdlibGenMethods = {
	...builderMethods,
	...bytesMethods,
	...errorsMethods,
	...fmtMethods,
	...gomMethods,
	...htmlMethods,
	...ioMethods,
	...mapsMethods,
	...mathMethods,
	...osMethods,
	...pathMethods,
	...randMethods,
	...regexpMethods,
	...slicesMethods,
	...sortMethods,
	...strconvMethods,
	...stringsMethods,
	...timeMethods,
	...unicodeMethods,
	...utf8Methods,
	...dispatchMethods,
};
