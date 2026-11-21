import { shadowsJsGlobal } from "../../typechecker/types.js";

// Struct fields and methods are JS properties under their Go name.  A name the
// runtime itself uses as a property (`__clone`, `__t`, `__ref`, ...) would
// overwrite or be overwritten by it, so every `__` member gets a `$` suffix,
// the rule `jsSafeName` applies to bindings.  `fmt` still prints the Go name.
export const jsMemberName = (n) =>
	typeof n === "string" && n.startsWith("__") && !n.includes("$") ? `${n}$` : n;

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
	"false",
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
	"true",
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

// JS name of the class emitted for a Go type.  Only strict-mode words need an
// escape (`class yield` is a syntax error); `__T` and the like stay as written.
export const jsClassName = (n) =>
	typeof n === "string" && JS_RESERVED.has(n) ? `${n}$` : n;

// Go declarations may shadow browser globals (Task 0.9).  The JS bundle is one
// flat module scope, so such a binding gets a `$` suffix: generated code and
// other packages keep reaching the real global (`Array.from`, `Object.keys`).
export const jsBindingName = (n) =>
	typeof n === "string" && shadowsJsGlobal(n) ? `${n}$` : jsSafeName(n);
