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

	emitFprintCall(fn, call, _targetWasmType) {
		const args = this._expandTupleFmtArgs(call.args);
		const wExpr = args[0];
		const strTmp = this.acquireTemp("externref");
		this._emitFprintFormatString(fn, args.slice(1));
		this.pushInstruction({ op: "local.set", index: strTmp });

		this._emitWriterWrite(wExpr, strTmp);
		this.releaseTemp(strTmp, "externref");
	}

	_emitFprintFormatString(fn, restArgs) {
		if (fn === "Fprintf") {
			const [format, ...rest] = restArgs;
			const temps = this._emitArgBuffer(
				rest,
				false,
				this._fmtNeedsTypes(format, rest),
			);
			this.emitExpr(format, "externref");
			this._callStdlib("fmt_sprintf");
			this._releaseArgBuffer(temps);
			return;
		}
		const argc = restArgs.length;
		if (argc === 0) {
			const s = fn === "Fprintln" ? "\n" : "";
			const strIdx = this.mod.internString(s);
			this.pushInstruction({ op: "i32.const", value: strIdx });
			this.pushInstruction({
				op: "call",
				funcIndex: this.mod.getStringImportIndex(),
			});
			return;
		}
		if (fn === "Fprint") {
			// Sprint's spacing rule: a space only between two non-strings.
			const temps = this._emitArgBuffer(restArgs, true);
			this.pushInstruction({ op: "i32.const", value: 0 });
			this._callStdlib("fmt_sprint");
			this._releaseArgBuffer(temps);
			return;
		}
		const sep = fn === "Fprintln" ? " " : "";
		const suffix = fn === "Fprintln" ? "\n" : "";
		const fmt = Array(argc).fill("%v").join(sep) + suffix;
		const temps = this._emitArgBuffer(restArgs);
		const strIdx = this.mod.internString(fmt);
		this.pushInstruction({ op: "i32.const", value: strIdx });
		this.pushInstruction({
			op: "call",
			funcIndex: this.mod.getStringImportIndex(),
		});
		this._callStdlib("fmt_sprintf");
		this._releaseArgBuffer(temps);
	}
}
