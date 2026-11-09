// src/backend/wasm/stdlib/io.js
// FunctionEmitter mixin: io, readers/writers, fmt.Fprint*.

export class IoEmitter {
	_emitWriterWrite(wExpr, strTmp) {
		const wTmp = this.acquireTemp("anyref");
		this.emitExpr(wExpr, "anyref");
		this.pushInstruction({ op: "local.set", index: wTmp });

		this.pushInstruction({ op: "local.get", index: wTmp });
		this.pushInstruction({ op: "local.get", index: strTmp });
		this._emitStringToByteSlice({ elem: { kind: "basic", name: "byte" } });

		const dispatchIdx = this.mod.resolveFuncIndex("__dispatch_io.Writer_Write");
		if (dispatchIdx !== null) {
			this.pushInstruction({ op: "call", funcIndex: dispatchIdx });
		} else {
			this.pushInstruction({ op: "i64.const", value: 0n });
			this.pushInstruction({ op: "ref.null", heapType: "any" });
		}
		this.releaseTemp(wTmp, "anyref");
	}

	// `fmt.Fprintf(w, format, operands...)`: the other Fprint functions are
	// Go source (stdlib/fmt).
	emitFprintCall(_fn, call, _targetWasmType) {
		const args = this._expandTupleFmtArgs(call.args);
		const wExpr = args[0];
		const strTmp = this.acquireTemp("externref");
		const [format, ...rest] = args.slice(1);
		const temps = this._emitArgBuffer(
			rest,
			false,
			this._fmtNeedsTypes(format, rest),
		);
		this.emitExpr(format, "externref");
		this._callStdlib("fmt_sprintf");
		this._releaseArgBuffer(temps);
		this.pushInstruction({ op: "local.set", index: strTmp });

		this._emitWriterWrite(wExpr, strTmp);
		this.releaseTemp(strTmp, "externref");
	}
}
