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
		if (fn === "Unwrap") return `(${args[0]}?._cause ?? null)`;
		if (fn === "As") {
			this.useHelper("errorAs");
			const targetGoType = expr?.args?.[1]?._type;
			const baseGoType = targetGoType?.base ?? targetGoType;
			const concreteGoType = baseGoType?.base ?? baseGoType;
			const typeName = concreteGoType?.name;
			if (typeName) {
				return `__errorAs(${args[0]}, ${args[1]}, (x) => x instanceof ${typeName} || x?.constructor?.name === "${typeName}" || x?.__struct === "${typeName}")`;
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
