// JS natives: host code that replaces a call to a `//gofront:native` stdlib
// function.  The Go body is the specification and is always emitted when
// reachable; an implementation either returns a JS expression for the call or
// `null` to decline, in which case the call goes to the Go body.
//
// An implementation is `(args, typeArgs) => string | null`.  `args` are the
// call's argument expressions (opaque strings) and `typeArgs` the instantiated
// type arguments of a generic function.  It must return a primary expression
// or parenthesise its own result, and must reproduce Go's behaviour (strict
// bounds panics, wrapping, nil slices) for every instantiation it accepts.
// The framework evaluates each argument once, in order, however many times the
// template mentions it.

export const JS_NATIVES = new Map();

// Marks an argument position inside a template.
const MARK = (i) => `\u00ab${i}\u00bb`;
const MARK_RE = /\u00ab(\d+)\u00bb/g;

// Arguments that are safe to repeat or reorder: names, member chains and
// plain literals have no side effects and are cheap to evaluate twice.
const SIMPLE_ARG =
	/^(?:[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*|-?\d+(?:\.\d+)?n?|"(?:[^"\\]|\\.)*")$/;

// The JS for a call of native `name`, or null when it is not registered or
// declines this instantiation.  `args` are the already-generated argument
// expressions.
export function jsNativeCall(name, args, typeArgs) {
	const impl = JS_NATIVES.get(name);
	if (!impl) return null;
	const template = impl(
		args.map((_, i) => MARK(i)),
		typeArgs,
	);
	if (template == null) return null;
	const wrap = (a) => (SIMPLE_ARG.test(a) ? a : `(${a})`);
	const seq = [...template.matchAll(MARK_RE)].map((m) => Number(m[1]));
	const inOrder = seq.length === args.length && seq.every((v, i) => v === i);
	if (inOrder || args.every((a) => SIMPLE_ARG.test(a)))
		return template.replace(MARK_RE, (_, i) => wrap(args[Number(i)]));
	// An argument with effects is repeated, dropped or reordered: evaluate
	// every argument once, in order, into a temporary.
	const names = args.map((_, i) => `$n${i}`);
	const body = template.replace(MARK_RE, (_, i) => names[Number(i)]);
	return `((${names.join(", ")}) => ${body})(${args.join(", ")})`;
}
