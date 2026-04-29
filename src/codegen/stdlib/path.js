// CodeGen for Go `path` package.

const PATH_DISPATCH = {
	Base: (a) =>
		`((p) => { if (!p) return "."; const stripped = p.replace(/\\/+$/, ""); if (!stripped) return "/"; const i = stripped.lastIndexOf("/"); return i < 0 ? stripped : stripped.slice(i + 1) || "/"; })(${a[0]})`,
	Dir: (a) =>
		`((p) => { const i = p.lastIndexOf("/"); if (i < 0) return "."; if (i === 0) return "/"; return p.slice(0, i); })(${a[0]})`,
	Ext: (a) =>
		`((p) => { const b = p.slice(p.lastIndexOf("/") + 1); const i = b.lastIndexOf("."); return i <= 0 ? "" : b.slice(i); })(${a[0]})`,
	IsAbs: (a) => `(${a[0]}).startsWith("/")`,
	Split: (a) =>
		`((p) => { const i = p.lastIndexOf("/"); return i < 0 ? ["", p] : [p.slice(0, i + 1), p.slice(i + 1)]; })(${a[0]})`,
	Match: (a) =>
		`((pat, name) => { try { const sp=/[.+^$()|[\\]\\\\]/g; const re = new RegExp("^" + pat.replace(sp, "\\\\$&").replace(/\\*/g, "[^/]*").replace(/\\?/g, "[^/]") + "$"); return [re.test(name), null]; } catch(e) { return [false, "syntax error in pattern"]; } })(${a[0]}, ${a[1]})`,
};

export const pathMethods = {
	_genPath(fn, a, expr) {
		if (fn === "Join") {
			this._usesPathClean = true;
			const allArgs = expr.args.map((e) => this.genExpr(e)).join(", ");
			return `__pathClean([${allArgs}].filter(x => x !== "").join("/"))`;
		}
		if (fn === "Clean") {
			this._usesPathClean = true;
			return `__pathClean(${a()[0]})`;
		}
		const gen = PATH_DISPATCH[fn];
		return gen ? gen(a()) : undefined;
	},
};
