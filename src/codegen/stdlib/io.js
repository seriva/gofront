// CodeGen for Go `io` package.

/** @typedef {import('../index.js').CodeGen} CodeGen */

/** @type {ThisType<CodeGen>} */
export const ioMethods = {
	_genIo(fn, _a, expr) {
		switch (fn) {
			case "WriteString": {
				const writerArg = expr.args[0];
				const writerType = writerArg._type;
				const typeName =
					writerType?.name ??
					(writerType?.kind === "pointer" ? writerType.base?.name : null);
				const w = this.genExpr(writerArg);
				const s = this.genExpr(expr.args[1]);
				const isPtr = writerType?.kind === "pointer";
				const base = isPtr ? `${w}.value` : w;
				if (typeName === "strings.Builder") {
					return `((b,s) => { b._buf += s; return [s.length, null]; })(${base}, ${s})`;
				}
				if (typeName === "bytes.Buffer") {
					return `((b,s) => { b._buf.push(...new TextEncoder().encode(s)); return [s.length, null]; })(${base}, ${s})`;
				}
				// Generic: auto-dereference pointer, then dispatch on concrete writer type.
				// strings.Builder has { _buf: string }, bytes.Buffer has { _buf: [] }.
				return `((b,s) => { const w = b?.value ?? b; if (typeof w.WriteString === "function") return [w.WriteString(s), null]; if (typeof w._buf === "string") { w._buf += s; return [s.length, null]; } if (Array.isArray(w._buf)) { w._buf.push(...new TextEncoder().encode(s)); return [s.length, null]; } return [0, "io.WriteString: unsupported writer"]; })(${w}, ${s})`;
			}
			case "ReadAll": {
				const r = this.genExpr(expr.args[0]);
				return `((r) => { const w = r?.value ?? r; if (typeof w._src === "string") { const s = w._src.slice(w._pos); w._pos = w._src.length; return [[...s].map(c => c.charCodeAt(0)), null]; } if (Array.isArray(w._src)) { const b = w._src.slice(w._pos); w._pos = w._src.length; return [b, null]; } const chunks = []; const buf = new Array(4096); let err = null; while (!err) { const [n, e] = w.Read(buf); if (n > 0) chunks.push(...buf.slice(0, n)); err = e; } return [chunks, err === "EOF" ? null : err]; })(${r})`;
			}
		}
		return undefined;
	},
};
