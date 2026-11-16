// Struct fields and methods are JS properties under their Go name.  A name the
// runtime itself uses as a property (`__clone`, `__t`, `__ref`, ...) would
// overwrite or be overwritten by it, so every `__` member gets a `$` suffix,
// the rule `jsSafeName` applies to bindings.  `fmt` still prints the Go name.
export const jsMemberName = (n) =>
	typeof n === "string" && n.startsWith("__") && !n.includes("$") ? `${n}$` : n;
