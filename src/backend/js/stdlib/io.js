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
			case "LimitReader": {
				this.useHelper("ioEOF");
				const r = this.genExpr(expr.args[0]);
				const n = this.genExpr(expr.args[1]);
				return `((r, n) => {
					let rem = typeof n === "bigint" ? Number(n) : Number(n);
					const reader = r?.value ?? r;
					return {
						Read(buf) {
							if (rem <= 0) return [0, __io_eof];
							const max = buf.length > rem ? rem : buf.length;
							const slice = buf.subarray ? buf.subarray(0, max) : buf.slice(0, max);
							const [readN, err] = reader.Read(slice);
							if (readN > 0) {
								if (buf.set && slice !== buf) buf.set(slice.subarray(0, readN), 0);
								rem -= readN;
							}
							return [readN, err];
						}
					};
				})(${r}, ${n})`;
			}
			case "Copy": {
				this.useHelper("ioEOF");
				const dst = this.genExpr(expr.args[0]);
				const src = this.genExpr(expr.args[1]);
				return `((dst, src) => {
					const w = dst?.value ?? dst;
					const r = src?.value ?? src;
					const writeChunk = (chunk) => {
						if (typeof w?.Write === "function") return w.Write(chunk);
						if (Array.isArray(w?._buf)) {
							for (let i = 0; i < chunk.length; i++) w._buf.push(chunk[i]);
							return [chunk.length, null];
						}
						if (typeof w?._buf === "string") {
							w._buf += new TextDecoder().decode(chunk);
							return [chunk.length, null];
						}
						return [0, "unsupported writer"];
					};
					const buf = new Uint8Array(32 * 1024);
					let total = 0;
					while (true) {
						const [n, rerr] = r.Read(buf);
						if (n > 0) {
							const chunk = buf.subarray(0, n);
							const [wn, werr] = writeChunk(chunk);
							total += wn;
							if (werr) return [total, werr];
						}
						if (rerr) {
							if (rerr === "EOF" || rerr === __io_eof || rerr?._msg === "EOF") return [total, null];
							return [total, rerr];
						}
					}
				})(${dst}, ${src})`;
			}
			case "CopyN": {
				this.useHelper("ioEOF");
				const dst = this.genExpr(expr.args[0]);
				const src = this.genExpr(expr.args[1]);
				const n = this.genExpr(expr.args[2]);
				return `((dst, src, n) => {
					const w = dst?.value ?? dst;
					const r = src?.value ?? src;
					const writeChunk = (chunk) => {
						if (typeof w?.Write === "function") return w.Write(chunk);
						if (Array.isArray(w?._buf)) {
							for (let i = 0; i < chunk.length; i++) w._buf.push(chunk[i]);
							return [chunk.length, null];
						}
						if (typeof w?._buf === "string") {
							w._buf += new TextDecoder().decode(chunk);
							return [chunk.length, null];
						}
						return [0, "unsupported writer"];
					};
					let rem = typeof n === "bigint" ? Number(n) : Number(n);
					let total = 0;
					const buf = new Uint8Array(32 * 1024);
					while (rem > 0) {
						const toRead = rem < buf.length ? rem : buf.length;
						const [rn, rerr] = r.Read(buf.subarray(0, toRead));
						if (rn > 0) {
							const [wn, werr] = writeChunk(buf.subarray(0, rn));
							total += wn;
							rem -= wn;
							if (werr) return [total, werr];
						}
						if (rerr) {
							if ((rerr === "EOF" || rerr === __io_eof || rerr?._msg === "EOF") && rem === 0) {
								return [total, null];
							}
							return [total, rerr];
						}
					}
					return [total, null];
				})(${dst}, ${src}, ${n})`;
			}
		}
		return undefined;
	},
};
