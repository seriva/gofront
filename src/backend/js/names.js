// Names a Go declaration may not keep in the flat JS bundle, and the rename
// applied to them.  Shared by the declaration side (index.js) and the
// bundled-package selector (expressions.js), which must agree.

import { shadowsJsGlobal } from "../../typechecker/types.js";

// Valid Go identifiers that cannot be used as JS bindings; emitted with a `$` suffix.
export const JS_RESERVED = new Set([
	"arguments",
	"await",
	"catch",
	"class",
	"debugger",
	"delete",
	"do",
	"enum",
	"eval",
	"export",
	"extends",
	"finally",
	"function",
	"implements",
	"in",
	"instanceof",
	"let",
	"new",
	"null",
	"private",
	"protected",
	"public",
	"static",
	"super",
	"this",
	"throw",
	"try",
	"typeof",
	"undefined",
	"void",
	"while",
	"with",
	"yield",
]);

// Names a Go program may not reuse in the flat bundle: JS keywords, and
// anything starting with `__`, the prefix of every runtime helper (`__len`,
// `__append`, ...).  Go identifiers never contain `$`, so a name that does was
// synthesised by lowering (`__fwd$1`) and is left alone.
export const jsSafeName = (n) =>
	typeof n === "string" &&
	(JS_RESERVED.has(n) || (n.startsWith("__") && !n.includes("$")))
		? `${n}$`
		: n;

// Go declarations may shadow browser globals (Task 0.9).  The JS bundle is one
// flat module scope, so such a binding gets a `$` suffix: generated code and
// other packages keep reaching the real global (`Array.from`, `Object.keys`).
export const jsBindingName = (n) =>
	typeof n === "string" && shadowsJsGlobal(n) ? `${n}$` : jsSafeName(n);
