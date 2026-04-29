// CodeGen for Go `unicode/utf8` package.

const UTF8_DISPATCH = {
	RuneCountInString: (a) => `[...(${a[0]})].length`,
	RuneLen: (a) =>
		`((r) => r < 0 ? -1 : r <= 0x7F ? 1 : r <= 0x7FF ? 2 : r <= 0xFFFF ? (r >= 0xD800 && r <= 0xDFFF ? -1 : 3) : r <= 0x10FFFF ? 4 : -1)(${a[0]})`,
	ValidString: (a) =>
		`/[\\uD800-\\uDBFF](?![\\uDC00-\\uDFFF])|(?<![\\uD800-\\uDBFF])[\\uDC00-\\uDFFF]/.test(${a[0]}) === false`,
	ValidRune: (a) =>
		`(${a[0]}) >= 0 && (${a[0]}) <= 0x10FFFF && !((${a[0]}) >= 0xD800 && (${a[0]}) <= 0xDFFF)`,
	DecodeRuneInString: (a) =>
		`((s) => { if (!s) return [0xFFFD, 0]; const cp = s.codePointAt(0); return [cp, cp > 0xFFFF ? 2 : 1]; })(${a[0]})`,
	DecodeLastRuneInString: (a) =>
		`((s) => { if (!s) return [0xFFFD, 0]; const i = s.length > 1 && s.charCodeAt(s.length - 1) >= 0xDC00 && s.charCodeAt(s.length - 1) <= 0xDFFF ? s.length - 2 : s.length - 1; const cp = s.codePointAt(i); return [cp, cp > 0xFFFF ? 2 : 1]; })(${a[0]})`,
	FullRuneInString: (a) => `(${a[0]}).length > 0`,
};

export const utf8Methods = {
	_genUtf8(fn, a) {
		const gen = UTF8_DISPATCH[fn];
		return gen ? gen(a()) : undefined;
	},
};
