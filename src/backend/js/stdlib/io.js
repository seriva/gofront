// CodeGen for Go `io` package.

/** @typedef {import('../index.js').CodeGen} CodeGen */

/** @type {ThisType<CodeGen>} */
export const ioMethods = {
	_genIo(fn, _a, expr) {
		if (fn === "ReadAll") this.useHelper("error");
		switch (fn) {
			case "WriteString": {
				const writerArg = expr.args[0];
				const writerType = writerArg._type;
				const typeName =
					writerType?.name ??
					(writerType?.kind === "pointer" ? writerType.base?.name : null);
				const w = this.genExpr(writerArg);
				const s = this.genExpr(expr.args[1]);
				const base = this._unboxWriter(w);
				if (typeName === "strings.Builder") {
					return `((b,s) => { b._buf += s; return [s.length, null]; })(${base}, ${s})`;
				}
				if (typeName === "bytes.Buffer") {
					return `((b,s) => { const bytes = new TextEncoder().encode(s); for (let i = 0; i < bytes.length; i++) b._buf.push(bytes[i]); return [bytes.length, null]; })(${base}, ${s})`;
				}
				// Generic: auto-dereference pointer, then dispatch on concrete writer type.
				// strings.Builder has { _buf: string }, bytes.Buffer has { _buf: [] }.
				return `((b,s) => { const w = b?.value ?? b; if (typeof w.WriteString === "function") return w.WriteString(s); if (typeof w._buf === "string") { w._buf += s; return [s.length, null]; } if (Array.isArray(w._buf)) { const bytes = new TextEncoder().encode(s); for (let i = 0; i < bytes.length; i++) w._buf.push(bytes[i]); return [bytes.length, null]; } if (typeof w.Write === "function") return w.Write(new TextEncoder().encode(s)); return [0, "io.WriteString: unsupported writer"]; })(${w}, ${s})`;
			}
			case "ReadAll": {
				this.useHelper("ioEOF");
				const r = this.genExpr(expr.args[0]);
				return `((r) => { const w = r?.value ?? r; const chunks = []; const buf = new Uint8Array(512); let err = null; while (!err) { const [n, e] = w.Read(buf); if (n > 0) { for (let i = 0; i < n; i++) chunks.push(buf[i]); } if (n === 0 && !e) break; err = e; } return [new Uint8Array(chunks), (err === "EOF" || err === __io_eof || err?._msg === "EOF") ? null : err]; })(${r})`;
			}
		}
		return undefined;
	},
};
