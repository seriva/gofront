// JS bodies of the host side of the unicode intrinsics (unicode_is,
// unicode_to_upper, unicode_to_lower).  The JS backend inlines them as the
// intrinsic bodies and the WASM boundary ships them as `env` imports, so
// both targets answer from the same tables.  Each takes the names of the
// parameters it reads and returns statements ending in a `return`.

// Classes, in the order of the constants in stdlib/unicode/unicode.go: the
// test of the one-code-point string `c`.
const CLASS_TESTS = [
	"/\\p{L}/u.test(c)", // Letter
	"/\\p{Nd}/u.test(c)", // Digit
	"/[ \\t\\n\\v\\f\\r\\u0085\\u00A0\\u1680\\u2000-\\u200A\\u2028\\u2029\\u202F\\u205F\\u3000]/.test(c)", // Space
	"/\\p{Lu}/u.test(c)", // Upper
	"/\\p{Ll}/u.test(c)", // Lower
	"/\\p{P}/u.test(c)", // Punct
	"/\\p{Cc}/u.test(c)", // Control
	"!/\\p{Cc}/u.test(c)", // Print
	"!/\\p{Cc}/u.test(c)", // Graphic
];

export function unicodeIsJs(r, cls) {
	const cases = CLASS_TESTS.map((test, i) => `case ${i}: return ${test};`).join(
		" ",
	);
	return `const c = String.fromCodePoint(${r}); switch (${cls}) { ${cases} } return false;`;
}

// A letter whose upper case spans several code points (the German sharp s)
// stays as it is.
export function unicodeToUpperJs(r) {
	return `const m = String.fromCodePoint(${r}).toUpperCase(); const u = m.codePointAt(0); return m.length > (u > 0xffff ? 2 : 1) ? ${r} : u;`;
}

export function unicodeToLowerJs(r) {
	return `return String.fromCodePoint(${r}).toLowerCase().codePointAt(0);`;
}
