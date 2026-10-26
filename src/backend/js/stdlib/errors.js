// CodeGen for Go `errors` package.

/** @typedef {import('../index.js').CodeGen} CodeGen */

/** @type {ThisType<CodeGen>} */
export const errorsMethods = {
	_genErrors(fn, a, expr) {
		const args = a();
		if (fn === "New") {
			this.useHelper("error");
			return `__error(${args[0]})`;
		}
		if (fn === "Is") {
			this.useHelper("errorIs");
			return `__errorIs(${args[0]}, ${args[1]})`;
		}
		if (fn === "Unwrap")
			return `((e) => typeof e?.Unwrap === "function" ? e.Unwrap() : (e?._cause ?? null))(${args[0]})`;
		if (fn === "As") {
			this.useHelper("errorAs");
			const targetGoType = expr?.args?.[1]?._type;
			const baseGoType = targetGoType?.base ?? targetGoType;
			const concreteGoType = baseGoType?.base ?? baseGoType;
			const typeName = concreteGoType?.name;
			if (concreteGoType?.kind === "interface" || typeName === "error") {
				return `__errorAs(${args[0]}, ${args[1]}, (x) => x !== null && (typeof x === "object" ? typeof x.Error === "function" : true))`;
			}
			// Named non-struct error types sit in interfaces as boxes; store the raw value.
			const namedBox = this._namedBoxInfo(concreteGoType);
			if (namedBox) {
				return `__errorAs(${args[0]}, ${args[1]}, (x) => x instanceof ${namedBox.cls}, (x) => x.__gfUnbox())`;
			}
			if (typeName) {
				return `__errorAs(${args[0]}, ${args[1]}, (x) => (typeof ${typeName} === "function" && x instanceof ${typeName}) || x?.constructor?.name === "${typeName}" || x?.__struct === "${typeName}")`;
			}
			return `__errorAs(${args[0]}, ${args[1]})`;
		}
		if (fn === "Join") {
			this.useHelper("error");
			this.useHelper("errorJoin");
			return `__errorJoin(${args.join(", ")})`;
		}
		return undefined;
	},
};
