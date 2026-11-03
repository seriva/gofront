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
			case "Testing":
				return "true";
			case "Init":
				return "/* testing.Init */";
			case "Benchmark":
				this.useHelper("testing");
				return `__testing_Benchmark(${_a()[0]})`;
		}
		return undefined;
	},

	_genTestingMethodCall(method, expr) {
		this.useHelper("testing");
		const recv = expr.func.expr;
		const t = this.genExpr(recv);
		const args = expr.args
			.map((a) => (a._spread ? `...${this.genExpr(a)}` : this.genExpr(a)))
			.join(", ");
		if (["Errorf", "Fatalf", "Logf", "Skipf"].includes(method))
			this.useHelper("sprintf");
		// There is never a deadline: the zero time and false.
		if (method === "Deadline") {
			const time = this.checker?.types?.get("time.Time")?.name;
			if (time) return `(${t}, [new ${time}(), false])`;
		}
		return `${t}.${method}(${args})`;
	},
};
