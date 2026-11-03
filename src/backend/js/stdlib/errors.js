// CodeGen for Go `errors` package: only `As`, which stores through a pointer
// target whose type the backend knows.  The rest of the package is Go source.

/** @typedef {import('../index.js').CodeGen} CodeGen */

/** @type {ThisType<CodeGen>} */
export const errorsMethods = {
	_genErrors(fn, a, expr) {
		if (fn !== "As") return undefined;
		const args = a();
		this.useHelper("errorAs");
		const head = `__errorAs(${args[0]}, ${args[1]}`;
		const matcher = this._errorsAsMatcher(expr?.args?.[1]?._type);
		return matcher ? `${head}, ${matcher})` : `${head})`;
	},

	// The `matcher[, extract]` arguments of `__errorAs` for a target of type
	// `targetGoType` (a pointer to the type being looked for), or null.
	_errorsAsMatcher(targetGoType) {
		const baseGoType = targetGoType?.base ?? targetGoType;
		const concreteGoType = baseGoType?.base ?? baseGoType;
		const typeName = concreteGoType?.name;
		const ifaceType =
			concreteGoType?.kind === "named"
				? concreteGoType.underlying
				: concreteGoType;
		const ifaceMethods = [...(ifaceType?.methods?.keys?.() ?? [])];
		if (
			ifaceType?.kind === "interface" &&
			typeName !== "error" &&
			ifaceMethods.length > 0
		) {
			const checks = ifaceMethods
				.map((m) => `typeof x.${m} === "function"`)
				.join(" && ");
			return `(x) => x !== null && typeof x === "object" && ${checks}`;
		}
		if (concreteGoType?.kind === "interface" || typeName === "error") {
			return `(x) => x !== null && (typeof x === "object" ? typeof x.Error === "function" : true)`;
		}
		// Named non-struct error types sit in interfaces as boxes; store the raw value.
		const namedBox = this._namedBoxInfo(concreteGoType);
		if (namedBox) {
			return `(x) => x instanceof ${namedBox.cls}, (x) => x.__gfUnbox()`;
		}
		if (typeName) {
			return `(x) => (typeof ${typeName} === "function" && x instanceof ${typeName}) || x?.constructor?.name === "${typeName}" || x?.__struct === "${typeName}"`;
		}
		return null;
	},
};
