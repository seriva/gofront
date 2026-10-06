// CodeGen for Go `testing` package and `*testing.T` methods.

/** @typedef {import('../index.js').CodeGen} CodeGen */

/** @type {ThisType<CodeGen>} */
export const testingMethods = {
	_genTesting(fn, _a) {
		switch (fn) {
			case "Short":
				return "false";
			case "Verbose":
				return "Boolean(globalThis.__gofront_verbose)";
		}
		return undefined;
	},

	_genTestingMethodCall(method, expr) {
		this._usesTesting = true;
		const recv = expr.func.expr;
		const t = this.genExpr(recv);
		const args = expr.args
			.map((a) => (a._spread ? `...${this.genExpr(a)}` : this.genExpr(a)))
			.join(", ");
		if (
			method === "Errorf" ||
			method === "Fatalf" ||
			method === "Logf" ||
			method === "Skipf"
		) {
			this._usesSprintf = true;
		}
		return `${t}.${method}(${args})`;
	},
};
