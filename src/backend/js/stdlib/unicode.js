// CodeGen for Go `unicode` package.

/** @typedef {import('../index.js').CodeGen} CodeGen */

/** @type {ThisType<CodeGen>} */
export const unicodeMethods = {
	_genUnicode(fn, a) {
		const [arg] = a();
		const cp = `String.fromCodePoint(${arg})`;
		const UNICODE_TEST = {
			IsLetter: `/\\p{L}/u.test(${cp})`,
			IsDigit: `/\\p{Nd}/u.test(${cp})`,
			IsSpace: `/\\s/.test(${cp})`,
			IsUpper: `/\\p{Lu}/u.test(${cp})`,
			IsLower: `/\\p{Ll}/u.test(${cp})`,
			IsPunct: `/\\p{P}/u.test(${cp})`,
			IsControl: `/\\p{Cc}/u.test(${cp})`,
			IsPrint: `!/\\p{Cc}/u.test(${cp})`,
			IsGraphic: `!/\\p{Cc}/u.test(${cp})`,
			ToUpper: `${cp}.toUpperCase().codePointAt(0)`,
			ToLower: `${cp}.toLowerCase().codePointAt(0)`,
		};
		return UNICODE_TEST[fn] ?? undefined;
	},
};
