// CodeGen for Go `path` package.

/** @typedef {import('../index.js').CodeGen} CodeGen */

const PATH_DISPATCH = {
	Base: (a) =>
		`((p) => { if (!p) return "."; const stripped = p.replace(/\\/+$/, ""); if (!stripped) return "/"; const i = stripped.lastIndexOf("/"); return i < 0 ? stripped : stripped.slice(i + 1) || "/"; })(${a[0]})`,
	Dir: (a) =>
		`((p) => { const i = p.lastIndexOf("/"); if (i < 0) return "."; const res = p.slice(0, i); return res === "" ? "/" : __pathClean(res); })(${a[0]})`,
	Ext: (a) =>
		`((p) => { const b = p.slice(p.lastIndexOf("/") + 1); const i = b.lastIndexOf("."); return i <= 0 ? "" : b.slice(i); })(${a[0]})`,
	IsAbs: (a) => `(${a[0]}).startsWith("/")`,
	Split: (a) =>
		`((p) => { const i = p.lastIndexOf("/"); return i < 0 ? ["", p] : [p.slice(0, i + 1), p.slice(i + 1)]; })(${a[0]})`,
	Match: (a) =>
		`((pat, name) => { const [m, err] = __pathMatch(pat, name); return [m, err ? __path_err_bad_pattern : null]; })(${a[0]}, ${a[1]})`,
};

/** @type {ThisType<CodeGen>} */
export const pathMethods = {
	_genPath(fn, a, expr) {
		if (fn === "Match") {
			this.useHelper("error");
			this.useHelper("pathClean");
		}
		if (fn === "Dir") {
			this.useHelper("pathClean");
		}
		if (fn === "Join") {
			this.useHelper("pathClean");
			const allArgs = expr.args
				.map((e) =>
					e._spread || expr.ellipsis
						? `...(${this.genExpr(e)})`
						: this.genExpr(e),
				)
				.join(", ");
			return `((arr) => arr.length === 0 ? "" : __pathClean(arr.join("/")))([${allArgs}].filter(x => x !== ""))`;
		}
		if (fn === "Clean") {
			this.useHelper("pathClean");
			return `__pathClean(${a()[0]})`;
		}
		const gen = PATH_DISPATCH[fn];
		return gen ? gen(a()) : undefined;
	},
};
