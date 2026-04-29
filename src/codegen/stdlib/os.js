// CodeGen for Go `os` package.

export const osMethods = {
	_genOs(fn, a) {
		const args = a();
		if (fn === "Exit") return `process.exit(${args[0]})`;
		if (fn === "Getenv") return `(process.env[${args[0]}] ?? "")`;
		return undefined;
	},
};
