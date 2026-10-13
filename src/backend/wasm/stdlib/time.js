// src/backend/wasm/stdlib/time.js
// FunctionEmitter mixin: time package.

const TIME_CONST_NAMES = new Set([
	"Nanosecond",
	"Microsecond",
	"Millisecond",
	"Second",
	"Minute",
	"Hour",
	"RFC3339",
	"RFC3339Nano",
	"DateOnly",
	"TimeOnly",
	"DateTime",
	"UTC",
	"Local",
	"January",
	"February",
	"March",
	"April",
	"May",
	"June",
	"July",
	"August",
	"September",
	"October",
	"November",
	"December",
	"Sunday",
	"Monday",
	"Tuesday",
	"Wednesday",
	"Thursday",
	"Friday",
	"Saturday",
]);

const DURATION_VALS = {
	Nanosecond: 1n,
	Microsecond: 1000n,
	Millisecond: 1000000n,
	Second: 1000000000n,
	Minute: 60000000000n,
	Hour: 3600000000000n,
};

const LAYOUT_STRS = {
	RFC3339: "2006-01-02T15:04:05Z07:00",
	RFC3339Nano: "2006-01-02T15:04:05.999999999Z07:00",
	DateOnly: "2006-01-02",
	TimeOnly: "15:04:05",
	DateTime: "2006-01-02 15:04:05",
};

const MONTH_VALS = {
	January: 1,
	February: 2,
	March: 3,
	April: 4,
	May: 5,
	June: 6,
	July: 7,
	August: 8,
	September: 9,
	October: 10,
	November: 11,
	December: 12,
};

const WEEKDAY_VALS = {
	Sunday: 0,
	Monday: 1,
	Tuesday: 2,
	Wednesday: 3,
	Thursday: 4,
	Friday: 5,
	Saturday: 6,
};

export class TimeEmitter {
	_isTimeConst(expr) {
		return (
			expr.expr?.kind === "Ident" &&
			expr.expr.name === "time" &&
			!this.resolveLocal("time") &&
			!this.mod.resolveGlobal("time") &&
			TIME_CONST_NAMES.has(expr.field)
		);
	}

	_isUtcExpr(expr) {
		if (!expr) return false;
		if (
			expr.kind === "SelectorExpr" &&
			(expr.sel?.name === "UTC" || expr.field === "UTC")
		)
			return true;
		if (expr.kind === "Ident" && expr.name === "UTC") return true;
		return false;
	}

	emitTimeConst(field, targetWasmType) {
		if (field in DURATION_VALS) {
			this.pushInstruction({ op: "i64.const", value: DURATION_VALS[field] });
			if (targetWasmType === "i32") {
				this.pushInstruction("i32.wrap_i64");
			}
			return;
		}
		if (field in LAYOUT_STRS) {
			this.emitBasicLit(
				{ kind: "BasicLit", litKind: "STRING", value: LAYOUT_STRS[field] },
				targetWasmType,
			);
			return;
		}
		if (field in MONTH_VALS) {
			const v = MONTH_VALS[field];
			if (targetWasmType === "i64") {
				this.pushInstruction({ op: "i64.const", value: BigInt(v) });
			} else {
				this.pushInstruction({ op: "i32.const", value: v });
			}
			return;
		}
		if (field in WEEKDAY_VALS) {
			const v = WEEKDAY_VALS[field];
			if (targetWasmType === "i64") {
				this.pushInstruction({ op: "i64.const", value: BigInt(v) });
			} else {
				this.pushInstruction({ op: "i32.const", value: v });
			}
			return;
		}
		if (field === "UTC" || field === "Local") {
			this.pushInstruction({ op: "ref.null", heapType: "any" });
		}
	}

	emitTimeCall(field, call, targetWasmType) {
		switch (field) {
			case "Now":
				this._emitTimeNow(targetWasmType);
				break;
			case "Since":
				this._emitTimeSince(call.args, targetWasmType);
				break;
			case "Unix":
				this._emitTimeUnix(call.args, targetWasmType);
				break;
			case "Date":
				this._emitTimeDate(call.args, targetWasmType);
				break;
			case "Parse":
				this._emitTimeParse(call.args, targetWasmType);
				break;
			default:
				throw new Error(`Unsupported time function '${field}'`);
		}
	}

	emitTimeMethodCall(field, expr, args, targetWasmType) {
		switch (field) {
			case "Format":
				this._emitTimeMethodFormat(expr, args, targetWasmType);
				break;
			case "String":
				this._emitTimeMethodString(expr, targetWasmType);
				break;
			case "Unix":
				this._emitTimeMethodUnix(expr, targetWasmType);
				break;
			case "UnixMilli":
				this._emitTimeMethodUnixMilli(expr, targetWasmType);
				break;
			case "Add":
				this._emitTimeMethodAdd(expr, args, targetWasmType);
				break;
			case "Sub":
				this._emitTimeMethodSub(expr, args, targetWasmType);
				break;
			case "Before":
				this._emitTimeMethodBefore(expr, args, targetWasmType);
				break;
			case "After":
				this._emitTimeMethodAfter(expr, args, targetWasmType);
				break;
			case "Equal":
				this._emitTimeMethodEqual(expr, args, targetWasmType);
				break;
			case "Hour":
				this._emitTimeMethodHour(expr, targetWasmType);
				break;
			case "Minute":
				this._emitTimeMethodMinute(expr, targetWasmType);
				break;
			case "Second":
				this._emitTimeMethodSecond(expr, targetWasmType);
				break;
			case "Weekday":
				this._emitTimeMethodWeekday(expr, targetWasmType);
				break;
			case "Year":
				this._emitTimeMethodYear(expr, targetWasmType);
				break;
			case "Month":
				this._emitTimeMethodMonth(expr, targetWasmType);
				break;
			case "Day":
				this._emitTimeMethodDay(expr, targetWasmType);
				break;
			default:
				throw new Error(`Unsupported time.Time method '${field}'`);
		}
	}

	_emitTimeNow(_targetWasmType) {
		const timeInfo = this.mod.getStructType("time.Time");
		const msTmp = this.acquireTemp("f64");
		const offTmp = this.acquireTemp("i32");
		this._callStdlib("time_now_ms");
		this.pushInstruction({ op: "local.tee", index: msTmp });
		this._callStdlib("time_timezone_offset");
		this.pushInstruction({ op: "local.set", index: offTmp });
		this.pushInstruction({ op: "local.get", index: msTmp });
		this.pushInstruction({ op: "f64.const", value: 1000000 });
		this.pushInstruction("f64.mul");
		this.pushInstruction("i64.trunc_sat_f64_s");
		this.pushInstruction({ op: "local.get", index: offTmp });
		this.pushInstruction({ op: "struct.new", typeIndex: timeInfo.typeIndex });
		this.releaseTemp(offTmp, "i32");
		this.releaseTemp(msTmp, "f64");
	}

	_emitTimeSince(args, targetWasmType) {
		const timeInfo = this.mod.getStructType("time.Time");
		const timeW = {
			kind: "ref",
			nullable: true,
			typeIndex: timeInfo.typeIndex,
		};
		const argTmp = this.acquireTemp(timeW);
		this.emitExpr(args[0], timeW);
		this.pushInstruction({ op: "local.set", index: argTmp });

		const msTmp = this.acquireTemp("f64");
		this._callStdlib("time_now_ms");
		this.pushInstruction({ op: "local.set", index: msTmp });
		this.pushInstruction({ op: "local.get", index: msTmp });
		this.pushInstruction({ op: "f64.const", value: 1000000 });
		this.pushInstruction("f64.mul");
		this.pushInstruction("i64.trunc_sat_f64_s");
		this.pushInstruction({ op: "local.get", index: argTmp });
		this.pushInstruction({
			op: "struct.get",
			typeIndex: timeInfo.typeIndex,
			fieldIndex: 0,
		});
		this.pushInstruction("i64.sub");
		this.releaseTemp(msTmp, "f64");
		this.releaseTemp(argTmp, timeW);

		if (targetWasmType === "i32") {
			this.pushInstruction("i32.wrap_i64");
		}
	}

	_emitTimeUnix(args, _targetWasmType) {
		const timeInfo = this.mod.getStructType("time.Time");
		const secTmp = this.acquireTemp("i64");
		const nsecTmp = this.acquireTemp("i64");
		const nanoTmp = this.acquireTemp("i64");
		const offTmp = this.acquireTemp("i32");

		this.emitExpr(args[0], "i64");
		this.pushInstruction({ op: "local.set", index: secTmp });
		this.emitExpr(args[1], "i64");
		this.pushInstruction({ op: "local.set", index: nsecTmp });

		this.pushInstruction({ op: "local.get", index: secTmp });
		this.pushInstruction({ op: "i64.const", value: 1000000000n });
		this.pushInstruction("i64.mul");
		this.pushInstruction({ op: "local.get", index: nsecTmp });
		this.pushInstruction("i64.add");
		this.pushInstruction({ op: "local.tee", index: nanoTmp });

		this.pushInstruction({ op: "i64.const", value: 1000000n });
		this.pushInstruction("i64.div_s");
		this.pushInstruction("f64.convert_i64_s");
		this._callStdlib("time_timezone_offset");
		this.pushInstruction({ op: "local.set", index: offTmp });

		this.pushInstruction({ op: "local.get", index: nanoTmp });
		this.pushInstruction({ op: "local.get", index: offTmp });
		this.pushInstruction({ op: "struct.new", typeIndex: timeInfo.typeIndex });

		this.releaseTemp(offTmp, "i32");
		this.releaseTemp(nanoTmp, "i64");
		this.releaseTemp(nsecTmp, "i64");
		this.releaseTemp(secTmp, "i64");
	}

	_emitCivilDays(yTmp, mTmp, dTmp, daysTmp) {
		// Evaluates:
		// if (m <= 2) y -= 1
		// era = (y >= 0 ? y : y - 399) / 400
		// yoe = y - era * 400
		// doy = (153 * (m > 2 ? m - 3 : m + 9) + 2) / 5 + d - 1
		// doe = yoe * 365 + yoe / 4 - yoe / 100 + doy
		// days = era * 146097 + doe - 719468
		const eraTmp = this.acquireTemp("i32");
		const yoeTmp = this.acquireTemp("i32");
		const doyTmp = this.acquireTemp("i32");
		const doeTmp = this.acquireTemp("i32");

		this.pushInstruction({ op: "local.get", index: mTmp });
		this.pushInstruction({ op: "i32.const", value: 2 });
		this.pushInstruction("i32.le_s");
		this.pushInstruction({ op: "if", blockType: "void" });
		this.pushInstruction({ op: "local.get", index: yTmp });
		this.pushInstruction({ op: "i32.const", value: 1 });
		this.pushInstruction("i32.sub");
		this.pushInstruction({ op: "local.set", index: yTmp });
		this.pushInstruction("end");

		this.pushInstruction({ op: "local.get", index: yTmp });
		this.pushInstruction({ op: "i32.const", value: 0 });
		this.pushInstruction("i32.ge_s");
		this.pushInstruction({ op: "if", blockType: "i32" });
		this.pushInstruction({ op: "local.get", index: yTmp });
		this.pushInstruction("else");
		this.pushInstruction({ op: "local.get", index: yTmp });
		this.pushInstruction({ op: "i32.const", value: 399 });
		this.pushInstruction("i32.sub");
		this.pushInstruction("end");
		this.pushInstruction({ op: "i32.const", value: 400 });
		this.pushInstruction("i32.div_s");
		this.pushInstruction({ op: "local.set", index: eraTmp });
		this.pushInstruction({ op: "local.get", index: yTmp });
		this.pushInstruction({ op: "local.get", index: eraTmp });
		this.pushInstruction({ op: "i32.const", value: 400 });
		this.pushInstruction("i32.mul");
		this.pushInstruction("i32.sub");
		this.pushInstruction({ op: "local.set", index: yoeTmp });

		// doy = (153 * (m > 2 ? m - 3 : m + 9) + 2) / 5 + d - 1
		this.pushInstruction({ op: "local.get", index: mTmp });
		this.pushInstruction({ op: "i32.const", value: 2 });
		this.pushInstruction("i32.gt_s");
		this.pushInstruction({ op: "if", blockType: "i32" });
		this.pushInstruction({ op: "local.get", index: mTmp });
		this.pushInstruction({ op: "i32.const", value: 3 });
		this.pushInstruction("i32.sub");
		this.pushInstruction("else");
		this.pushInstruction({ op: "local.get", index: mTmp });
		this.pushInstruction({ op: "i32.const", value: 9 });
		this.pushInstruction("i32.add");
		this.pushInstruction("end");
		this.pushInstruction({ op: "i32.const", value: 153 });
		this.pushInstruction("i32.mul");
		this.pushInstruction({ op: "i32.const", value: 2 });
		this.pushInstruction("i32.add");
		this.pushInstruction({ op: "i32.const", value: 5 });
		this.pushInstruction("i32.div_s");
		this.pushInstruction({ op: "local.get", index: dTmp });
		this.pushInstruction("i32.add");
		this.pushInstruction({ op: "i32.const", value: 1 });
		this.pushInstruction("i32.sub");
		this.pushInstruction({ op: "local.set", index: doyTmp });

		// doe = yoe * 365 + yoe / 4 - yoe / 100 + doy
		this.pushInstruction({ op: "local.get", index: yoeTmp });
		this.pushInstruction({ op: "i32.const", value: 365 });
		this.pushInstruction("i32.mul");
		this.pushInstruction({ op: "local.get", index: yoeTmp });
		this.pushInstruction({ op: "i32.const", value: 4 });
		this.pushInstruction("i32.div_s");
		this.pushInstruction("i32.add");
		this.pushInstruction({ op: "local.get", index: yoeTmp });
		this.pushInstruction({ op: "i32.const", value: 100 });
		this.pushInstruction("i32.div_s");
		this.pushInstruction("i32.sub");
		this.pushInstruction({ op: "local.get", index: doyTmp });
		this.pushInstruction("i32.add");
		this.pushInstruction({ op: "local.set", index: doeTmp });

		// days = era * 146097 + doe - 719468 (in i64)
		this.pushInstruction({ op: "local.get", index: eraTmp });
		this.pushInstruction("i64.extend_i32_s");
		this.pushInstruction({ op: "i64.const", value: 146097n });
		this.pushInstruction("i64.mul");
		this.pushInstruction({ op: "local.get", index: doeTmp });
		this.pushInstruction("i64.extend_i32_s");
		this.pushInstruction("i64.add");
		this.pushInstruction({ op: "i64.const", value: 719468n });
		this.pushInstruction("i64.sub");
		this.pushInstruction({ op: "local.set", index: daysTmp });

		this.releaseTemp(doeTmp, "i32");
		this.releaseTemp(doyTmp, "i32");
		this.releaseTemp(yoeTmp, "i32");
		this.releaseTemp(eraTmp, "i32");
	}

	_emitTimeDate(args, _targetWasmType) {
		const timeInfo = this.mod.getStructType("time.Time");
		const yTmp = this.acquireTemp("i32");
		const mTmp = this.acquireTemp("i32");
		const dTmp = this.acquireTemp("i32");
		const hrTmp = this.acquireTemp("i32");
		const minTmp = this.acquireTemp("i32");
		const secTmp = this.acquireTemp("i32");
		const nsecTmp = this.acquireTemp("i64");
		const locTmp = this.acquireTemp("anyref");

		this.emitExpr(args[0], "i32");
		this.pushInstruction({ op: "local.set", index: yTmp });
		this.emitExpr(args[1], "i32");
		this.pushInstruction({ op: "local.set", index: mTmp });
		this.emitExpr(args[2], "i32");
		this.pushInstruction({ op: "local.set", index: dTmp });
		this.emitExpr(args[3], "i32");
		this.pushInstruction({ op: "local.set", index: hrTmp });
		this.emitExpr(args[4], "i32");
		this.pushInstruction({ op: "local.set", index: minTmp });
		this.emitExpr(args[5], "i32");
		this.pushInstruction({ op: "local.set", index: secTmp });
		this.emitExpr(args[6], "i64");
		this.pushInstruction({ op: "local.set", index: nsecTmp });
		this.emitExpr(args[7], "anyref");
		this.pushInstruction({ op: "local.set", index: locTmp });

		const daysTmp = this.acquireTemp("i64");
		this._emitCivilDays(yTmp, mTmp, dTmp, daysTmp);

		const localSecTmp = this.acquireTemp("i64");
		// secOfDay = hr * 3600 + min * 60 + sec
		this.pushInstruction({ op: "local.get", index: hrTmp });
		this.pushInstruction({ op: "i32.const", value: 3600 });
		this.pushInstruction("i32.mul");
		this.pushInstruction({ op: "local.get", index: minTmp });
		this.pushInstruction({ op: "i32.const", value: 60 });
		this.pushInstruction("i32.mul");
		this.pushInstruction("i32.add");
		this.pushInstruction({ op: "local.get", index: secTmp });
		this.pushInstruction("i32.add");
		this.pushInstruction("i64.extend_i32_s");
		this.pushInstruction({ op: "local.get", index: daysTmp });
		this.pushInstruction({ op: "i64.const", value: 86400n });
		this.pushInstruction("i64.mul");
		this.pushInstruction("i64.add");
		this.pushInstruction({ op: "local.set", index: localSecTmp });

		const offTmp = this.acquireTemp("i32");
		if (this._isUtcExpr(args[7])) {
			this.pushInstruction({ op: "i32.const", value: 0 });
			this.pushInstruction({ op: "local.set", index: offTmp });
		} else {
			this.pushInstruction({ op: "local.get", index: localSecTmp });
			this.pushInstruction({ op: "i64.const", value: 1000n });
			this.pushInstruction("i64.mul");
			this.pushInstruction("f64.convert_i64_s");
			this._callStdlib("time_timezone_offset");
			this.pushInstruction({ op: "local.set", index: offTmp });
		}

		// unixSec = localSec - offset
		this.pushInstruction({ op: "local.get", index: localSecTmp });
		this.pushInstruction({ op: "local.get", index: offTmp });
		this.pushInstruction("i64.extend_i32_s");
		this.pushInstruction("i64.sub");
		this.pushInstruction({ op: "i64.const", value: 1000000000n });
		this.pushInstruction("i64.mul");
		this.pushInstruction({ op: "local.get", index: nsecTmp });
		this.pushInstruction("i64.add");

		this.pushInstruction({ op: "local.get", index: offTmp });
		this.pushInstruction({ op: "struct.new", typeIndex: timeInfo.typeIndex });

		this.releaseTemp(offTmp, "i32");
		this.releaseTemp(localSecTmp, "i64");
		this.releaseTemp(daysTmp, "i64");
		this.releaseTemp(locTmp, "anyref");
		this.releaseTemp(nsecTmp, "i64");
		this.releaseTemp(secTmp, "i32");
		this.releaseTemp(minTmp, "i32");
		this.releaseTemp(hrTmp, "i32");
		this.releaseTemp(dTmp, "i32");
		this.releaseTemp(mTmp, "i32");
		this.releaseTemp(yTmp, "i32");
	}

	_emitTimeParse(args, _targetWasmType) {
		const timeInfo = this.mod.getStructType("time.Time");
		const timeW = {
			kind: "ref",
			nullable: true,
			typeIndex: timeInfo.typeIndex,
		};
		const msTmp = this.acquireTemp("f64");
		const offTmp = this.acquireTemp("i32");
		const errStrTmp = this.acquireTemp("externref");
		const resTimeTmp = this.acquireTemp(timeW);
		const resErrTmp = this.acquireTemp("anyref");

		this.emitExpr(args[0], "externref");
		this.emitExpr(args[1], "externref");
		this._callStdlib("time_parse");
		this.pushInstruction({ op: "local.set", index: msTmp });
		this._callStdlib("time_parse_offset");
		this.pushInstruction({ op: "local.set", index: offTmp });
		this._callStdlib("time_parse_err");
		this.pushInstruction({ op: "local.set", index: errStrTmp });

		this.pushInstruction({ op: "local.get", index: errStrTmp });
		this.pushInstruction("ref.is_null");
		this.pushInstruction({ op: "if", blockType: "void" });

		// Success
		this.pushInstruction({ op: "local.get", index: msTmp });
		this.pushInstruction({ op: "f64.const", value: 1000000 });
		this.pushInstruction("f64.mul");
		this.pushInstruction("i64.trunc_sat_f64_s");
		this.pushInstruction({ op: "local.get", index: offTmp });
		this.pushInstruction({ op: "struct.new", typeIndex: timeInfo.typeIndex });
		this.pushInstruction({ op: "local.set", index: resTimeTmp });
		this.pushInstruction({ op: "ref.null", heapType: "any" });
		this.pushInstruction({ op: "local.set", index: resErrTmp });

		this.pushInstruction("else");

		// Error
		this.pushInstruction({ op: "i64.const", value: 0n });
		this.pushInstruction({ op: "i32.const", value: 0 });
		this.pushInstruction({ op: "struct.new", typeIndex: timeInfo.typeIndex });
		this.pushInstruction({ op: "local.set", index: resTimeTmp });
		this.pushInstruction({ op: "local.get", index: errStrTmp });
		this.pushInstruction({ op: "ref.null", heapType: "any" });
		this.pushInstruction({
			op: "call",
			funcIndex: this.mod.resolveFuncIndex("__mk_error"),
		});
		this.pushInstruction({ op: "local.set", index: resErrTmp });

		this.pushInstruction("end");

		this.pushInstruction({ op: "local.get", index: resTimeTmp });
		this.pushInstruction({ op: "local.get", index: resErrTmp });

		this.releaseTemp(resErrTmp, "anyref");
		this.releaseTemp(resTimeTmp, timeW);
		this.releaseTemp(errStrTmp, "externref");
		this.releaseTemp(offTmp, "i32");
		this.releaseTemp(msTmp, "f64");
	}

	_emitTimeMethodAdd(expr, args, _targetWasmType) {
		const timeInfo = this.mod.getStructType("time.Time");
		const timeW = {
			kind: "ref",
			nullable: true,
			typeIndex: timeInfo.typeIndex,
		};
		const rTmp = this.acquireTemp(timeW);
		const dTmp = this.acquireTemp("i64");

		this.emitExpr(expr, timeW);
		this.pushInstruction({ op: "local.set", index: rTmp });
		this.emitExpr(args[0], "i64");
		this.pushInstruction({ op: "local.set", index: dTmp });

		this.pushInstruction({ op: "local.get", index: rTmp });
		this.pushInstruction({
			op: "struct.get",
			typeIndex: timeInfo.typeIndex,
			fieldIndex: 0,
		});
		this.pushInstruction({ op: "local.get", index: dTmp });
		this.pushInstruction("i64.add");

		this.pushInstruction({ op: "local.get", index: rTmp });
		this.pushInstruction({
			op: "struct.get",
			typeIndex: timeInfo.typeIndex,
			fieldIndex: 1,
		});

		this.pushInstruction({ op: "struct.new", typeIndex: timeInfo.typeIndex });

		this.releaseTemp(dTmp, "i64");
		this.releaseTemp(rTmp, timeW);
	}

	_emitTimeMethodSub(expr, args, targetWasmType) {
		const timeInfo = this.mod.getStructType("time.Time");
		const timeW = {
			kind: "ref",
			nullable: true,
			typeIndex: timeInfo.typeIndex,
		};
		const rTmp = this.acquireTemp(timeW);
		const uTmp = this.acquireTemp(timeW);

		this.emitExpr(expr, timeW);
		this.pushInstruction({ op: "local.set", index: rTmp });
		this.emitExpr(args[0], timeW);
		this.pushInstruction({ op: "local.set", index: uTmp });

		this.pushInstruction({ op: "local.get", index: rTmp });
		this.pushInstruction({
			op: "struct.get",
			typeIndex: timeInfo.typeIndex,
			fieldIndex: 0,
		});
		this.pushInstruction({ op: "local.get", index: uTmp });
		this.pushInstruction({
			op: "struct.get",
			typeIndex: timeInfo.typeIndex,
			fieldIndex: 0,
		});
		this.pushInstruction("i64.sub");

		this.releaseTemp(uTmp, timeW);
		this.releaseTemp(rTmp, timeW);

		if (targetWasmType === "i32") {
			this.pushInstruction("i32.wrap_i64");
		}
	}

	_emitTimeMethodBefore(expr, args, _targetWasmType) {
		this._emitTimeCmp(expr, args, "i64.lt_s");
	}

	_emitTimeMethodAfter(expr, args, _targetWasmType) {
		this._emitTimeCmp(expr, args, "i64.gt_s");
	}

	_emitTimeMethodEqual(expr, args, _targetWasmType) {
		this._emitTimeCmp(expr, args, "i64.eq");
	}

	_emitTimeCmp(expr, args, op) {
		const timeInfo = this.mod.getStructType("time.Time");
		const timeW = {
			kind: "ref",
			nullable: true,
			typeIndex: timeInfo.typeIndex,
		};
		const rTmp = this.acquireTemp(timeW);
		const uTmp = this.acquireTemp(timeW);

		this.emitExpr(expr, timeW);
		this.pushInstruction({ op: "local.set", index: rTmp });
		this.emitExpr(args[0], timeW);
		this.pushInstruction({ op: "local.set", index: uTmp });

		this.pushInstruction({ op: "local.get", index: rTmp });
		this.pushInstruction({
			op: "struct.get",
			typeIndex: timeInfo.typeIndex,
			fieldIndex: 0,
		});
		this.pushInstruction({ op: "local.get", index: uTmp });
		this.pushInstruction({
			op: "struct.get",
			typeIndex: timeInfo.typeIndex,
			fieldIndex: 0,
		});
		this.pushInstruction(op);

		this.releaseTemp(uTmp, timeW);
		this.releaseTemp(rTmp, timeW);
	}

	_emitTimeMethodUnix(expr, targetWasmType) {
		const timeInfo = this.mod.getStructType("time.Time");
		const timeW = {
			kind: "ref",
			nullable: true,
			typeIndex: timeInfo.typeIndex,
		};
		this.emitExpr(expr, timeW);
		this.pushInstruction({
			op: "struct.get",
			typeIndex: timeInfo.typeIndex,
			fieldIndex: 0,
		});
		this.pushInstruction({ op: "i64.const", value: 1000000000n });
		this.pushInstruction("i64.div_s");
		if (targetWasmType === "i32") {
			this.pushInstruction("i32.wrap_i64");
		}
	}

	_emitTimeMethodUnixMilli(expr, targetWasmType) {
		const timeInfo = this.mod.getStructType("time.Time");
		const timeW = {
			kind: "ref",
			nullable: true,
			typeIndex: timeInfo.typeIndex,
		};
		this.emitExpr(expr, timeW);
		this.pushInstruction({
			op: "struct.get",
			typeIndex: timeInfo.typeIndex,
			fieldIndex: 0,
		});
		this.pushInstruction({ op: "i64.const", value: 1000000n });
		this.pushInstruction("i64.div_s");
		if (targetWasmType === "i32") {
			this.pushInstruction("i32.wrap_i64");
		}
	}

	_emitCivilDateFromDays(daysTmp, yTmp, mTmp, dTmp) {
		// Computes (y, m, d) in i32 from days in i64
		const d64 = this.acquireTemp("i64");
		this.pushInstruction({ op: "local.get", index: daysTmp });
		this.pushInstruction({ op: "i64.const", value: 719468n });
		this.pushInstruction("i64.add");
		this.pushInstruction({ op: "local.set", index: d64 });

		const eraTmp = this.acquireTemp("i32");
		const doeTmp = this.acquireTemp("i32");
		const yoeTmp = this.acquireTemp("i32");
		const doyTmp = this.acquireTemp("i32");
		const mpTmp = this.acquireTemp("i32");

		// era = (d64 >= 0 ? d64 : d64 - 146096n) / 146097n
		this.pushInstruction({ op: "local.get", index: d64 });
		this.pushInstruction({ op: "i64.const", value: 0n });
		this.pushInstruction("i64.ge_s");
		this.pushInstruction({ op: "if", blockType: "i64" });
		this.pushInstruction({ op: "local.get", index: d64 });
		this.pushInstruction("else");
		this.pushInstruction({ op: "local.get", index: d64 });
		this.pushInstruction({ op: "i64.const", value: 146096n });
		this.pushInstruction("i64.sub");
		this.pushInstruction("end");
		this.pushInstruction({ op: "i64.const", value: 146097n });
		this.pushInstruction("i64.div_s");
		this.pushInstruction("i32.wrap_i64");
		this.pushInstruction({ op: "local.set", index: eraTmp });

		// doe = i32(d64 - era * 146097n)
		this.pushInstruction({ op: "local.get", index: d64 });
		this.pushInstruction({ op: "local.get", index: eraTmp });
		this.pushInstruction("i64.extend_i32_s");
		this.pushInstruction({ op: "i64.const", value: 146097n });
		this.pushInstruction("i64.mul");
		this.pushInstruction("i64.sub");
		this.pushInstruction("i32.wrap_i64");
		this.pushInstruction({ op: "local.set", index: doeTmp });

		// yoe = (doe - doe/1460 + doe/36524 - doe/146096) / 365
		this.pushInstruction({ op: "local.get", index: doeTmp });
		this.pushInstruction({ op: "local.get", index: doeTmp });
		this.pushInstruction({ op: "i32.const", value: 1460 });
		this.pushInstruction("i32.div_s");
		this.pushInstruction("i32.sub");
		this.pushInstruction({ op: "local.get", index: doeTmp });
		this.pushInstruction({ op: "i32.const", value: 36524 });
		this.pushInstruction("i32.div_s");
		this.pushInstruction("i32.add");
		this.pushInstruction({ op: "local.get", index: doeTmp });
		this.pushInstruction({ op: "i32.const", value: 146096 });
		this.pushInstruction("i32.div_s");
		this.pushInstruction("i32.sub");
		this.pushInstruction({ op: "i32.const", value: 365 });
		this.pushInstruction("i32.div_s");
		this.pushInstruction({ op: "local.set", index: yoeTmp });

		// y = yoe + era * 400
		this.pushInstruction({ op: "local.get", index: yoeTmp });
		this.pushInstruction({ op: "local.get", index: eraTmp });
		this.pushInstruction({ op: "i32.const", value: 400 });
		this.pushInstruction("i32.mul");
		this.pushInstruction("i32.add");
		this.pushInstruction({ op: "local.set", index: yTmp });

		// doy = doe - (365*yoe + yoe/4 - yoe/100)
		this.pushInstruction({ op: "local.get", index: doeTmp });
		this.pushInstruction({ op: "local.get", index: yoeTmp });
		this.pushInstruction({ op: "i32.const", value: 365 });
		this.pushInstruction("i32.mul");
		this.pushInstruction({ op: "local.get", index: yoeTmp });
		this.pushInstruction({ op: "i32.const", value: 4 });
		this.pushInstruction("i32.div_s");
		this.pushInstruction("i32.add");
		this.pushInstruction({ op: "local.get", index: yoeTmp });
		this.pushInstruction({ op: "i32.const", value: 100 });
		this.pushInstruction("i32.div_s");
		this.pushInstruction("i32.sub");
		this.pushInstruction("i32.sub");
		this.pushInstruction({ op: "local.set", index: doyTmp });

		// mp = (5*doy + 2) / 153
		this.pushInstruction({ op: "local.get", index: doyTmp });
		this.pushInstruction({ op: "i32.const", value: 5 });
		this.pushInstruction("i32.mul");
		this.pushInstruction({ op: "i32.const", value: 2 });
		this.pushInstruction("i32.add");
		this.pushInstruction({ op: "i32.const", value: 153 });
		this.pushInstruction("i32.div_s");
		this.pushInstruction({ op: "local.set", index: mpTmp });

		// d = doy - (153*mp + 2)/5 + 1
		this.pushInstruction({ op: "local.get", index: doyTmp });
		this.pushInstruction({ op: "local.get", index: mpTmp });
		this.pushInstruction({ op: "i32.const", value: 153 });
		this.pushInstruction("i32.mul");
		this.pushInstruction({ op: "i32.const", value: 2 });
		this.pushInstruction("i32.add");
		this.pushInstruction({ op: "i32.const", value: 5 });
		this.pushInstruction("i32.div_s");
		this.pushInstruction("i32.sub");
		this.pushInstruction({ op: "i32.const", value: 1 });
		this.pushInstruction("i32.add");
		this.pushInstruction({ op: "local.set", index: dTmp });

		// m = mp + (mp < 10 ? 3 : -9)
		this.pushInstruction({ op: "local.get", index: mpTmp });
		this.pushInstruction({ op: "local.get", index: mpTmp });
		this.pushInstruction({ op: "i32.const", value: 10 });
		this.pushInstruction("i32.lt_s");
		this.pushInstruction({ op: "if", blockType: "i32" });
		this.pushInstruction({ op: "i32.const", value: 3 });
		this.pushInstruction("else");
		this.pushInstruction({ op: "i32.const", value: -9 });
		this.pushInstruction("end");
		this.pushInstruction("i32.add");
		this.pushInstruction({ op: "local.set", index: mTmp });

		// if (m <= 2) y += 1
		this.pushInstruction({ op: "local.get", index: mTmp });
		this.pushInstruction({ op: "i32.const", value: 2 });
		this.pushInstruction("i32.le_s");
		this.pushInstruction({ op: "if", blockType: "void" });
		this.pushInstruction({ op: "local.get", index: yTmp });
		this.pushInstruction({ op: "i32.const", value: 1 });
		this.pushInstruction("i32.add");
		this.pushInstruction({ op: "local.set", index: yTmp });
		this.pushInstruction("end");

		this.releaseTemp(mpTmp, "i32");
		this.releaseTemp(doyTmp, "i32");
		this.releaseTemp(yoeTmp, "i32");
		this.releaseTemp(doeTmp, "i32");
		this.releaseTemp(eraTmp, "i32");
		this.releaseTemp(d64, "i64");
	}

	_emitTimeDecomposeParts(expr) {
		const timeInfo = this.mod.getStructType("time.Time");
		const timeW = {
			kind: "ref",
			nullable: true,
			typeIndex: timeInfo.typeIndex,
		};
		const rTmp = this.acquireTemp(timeW);
		this.emitExpr(expr, timeW);
		this.pushInstruction({ op: "local.set", index: rTmp });

		const localSecTmp = this.acquireTemp("i64");
		const daysTmp = this.acquireTemp("i64");
		const remSecTmp = this.acquireTemp("i64");
		const offTmp = this.acquireTemp("i32");
		const nanoTmp = this.acquireTemp("i64");

		this.pushInstruction({ op: "local.get", index: rTmp });
		this.pushInstruction({
			op: "struct.get",
			typeIndex: timeInfo.typeIndex,
			fieldIndex: 0,
		});
		this.pushInstruction({ op: "local.set", index: nanoTmp });

		this.pushInstruction({ op: "local.get", index: rTmp });
		this.pushInstruction({
			op: "struct.get",
			typeIndex: timeInfo.typeIndex,
			fieldIndex: 1,
		});
		this.pushInstruction({ op: "local.set", index: offTmp });

		// localSec = nanoTmp / 1000000000n + offTmp
		this.pushInstruction({ op: "local.get", index: nanoTmp });
		this.pushInstruction({ op: "i64.const", value: 1000000000n });
		this.pushInstruction("i64.div_s");
		this.pushInstruction({ op: "local.get", index: offTmp });
		this.pushInstruction("i64.extend_i32_s");
		this.pushInstruction("i64.add");
		this.pushInstruction({ op: "local.set", index: localSecTmp });

		// days = localSec / 86400n
		this.pushInstruction({ op: "local.get", index: localSecTmp });
		this.pushInstruction({ op: "i64.const", value: 86400n });
		this.pushInstruction("i64.div_s");
		this.pushInstruction({ op: "local.set", index: daysTmp });

		// remSec = localSec % 86400n
		this.pushInstruction({ op: "local.get", index: localSecTmp });
		this.pushInstruction({ op: "i64.const", value: 86400n });
		this.pushInstruction("i64.rem_s");
		this.pushInstruction({ op: "local.tee", index: remSecTmp });
		this.pushInstruction({ op: "i64.const", value: 0n });
		this.pushInstruction("i64.lt_s");
		this.pushInstruction({ op: "if", blockType: "void" });
		this.pushInstruction({ op: "local.get", index: remSecTmp });
		this.pushInstruction({ op: "i64.const", value: 86400n });
		this.pushInstruction("i64.add");
		this.pushInstruction({ op: "local.set", index: remSecTmp });
		this.pushInstruction({ op: "local.get", index: daysTmp });
		this.pushInstruction({ op: "i64.const", value: 1n });
		this.pushInstruction("i64.sub");
		this.pushInstruction({ op: "local.set", index: daysTmp });
		this.pushInstruction("end");

		return { rTmp, timeW, localSecTmp, daysTmp, remSecTmp, offTmp, nanoTmp };
	}

	_emitTimeMethodHour(expr, targetWasmType) {
		const p = this._emitTimeDecomposeParts(expr);
		this.pushInstruction({ op: "local.get", index: p.remSecTmp });
		this.pushInstruction({ op: "i64.const", value: 3600n });
		this.pushInstruction("i64.div_s");
		this.pushInstruction("i32.wrap_i64");
		if (targetWasmType === "i64") this.pushInstruction("i64.extend_i32_s");
		this._releaseTimeDecomposeParts(p);
	}

	_emitTimeMethodMinute(expr, targetWasmType) {
		const p = this._emitTimeDecomposeParts(expr);
		this.pushInstruction({ op: "local.get", index: p.remSecTmp });
		this.pushInstruction({ op: "i64.const", value: 3600n });
		this.pushInstruction("i64.rem_s");
		this.pushInstruction({ op: "i64.const", value: 60n });
		this.pushInstruction("i64.div_s");
		this.pushInstruction("i32.wrap_i64");
		if (targetWasmType === "i64") this.pushInstruction("i64.extend_i32_s");
		this._releaseTimeDecomposeParts(p);
	}

	_emitTimeMethodSecond(expr, targetWasmType) {
		const p = this._emitTimeDecomposeParts(expr);
		this.pushInstruction({ op: "local.get", index: p.remSecTmp });
		this.pushInstruction({ op: "i64.const", value: 60n });
		this.pushInstruction("i64.rem_s");
		this.pushInstruction("i32.wrap_i64");
		if (targetWasmType === "i64") this.pushInstruction("i64.extend_i32_s");
		this._releaseTimeDecomposeParts(p);
	}

	_emitTimeMethodWeekday(expr, targetWasmType) {
		const p = this._emitTimeDecomposeParts(expr);
		const wdTmp = this.acquireTemp("i32");
		this.pushInstruction({ op: "local.get", index: p.daysTmp });
		this.pushInstruction({ op: "i64.const", value: 4n });
		this.pushInstruction("i64.add");
		this.pushInstruction({ op: "i64.const", value: 7n });
		this.pushInstruction("i64.rem_s");
		this.pushInstruction("i32.wrap_i64");
		this.pushInstruction({ op: "local.tee", index: wdTmp });
		this.pushInstruction({ op: "i32.const", value: 0 });
		this.pushInstruction("i32.lt_s");
		this.pushInstruction({ op: "if", blockType: "void" });
		this.pushInstruction({ op: "local.get", index: wdTmp });
		this.pushInstruction({ op: "i32.const", value: 7 });
		this.pushInstruction("i32.add");
		this.pushInstruction({ op: "local.set", index: wdTmp });
		this.pushInstruction("end");

		this.pushInstruction({ op: "local.get", index: wdTmp });
		if (targetWasmType === "i64") this.pushInstruction("i64.extend_i32_s");
		this.releaseTemp(wdTmp, "i32");
		this._releaseTimeDecomposeParts(p);
	}

	_emitTimeMethodYear(expr, targetWasmType) {
		const p = this._emitTimeDecomposeParts(expr);
		const yTmp = this.acquireTemp("i32");
		const mTmp = this.acquireTemp("i32");
		const dTmp = this.acquireTemp("i32");
		this._emitCivilDateFromDays(p.daysTmp, yTmp, mTmp, dTmp);
		this.pushInstruction({ op: "local.get", index: yTmp });
		if (targetWasmType === "i64") this.pushInstruction("i64.extend_i32_s");
		this.releaseTemp(dTmp, "i32");
		this.releaseTemp(mTmp, "i32");
		this.releaseTemp(yTmp, "i32");
		this._releaseTimeDecomposeParts(p);
	}

	_emitTimeMethodMonth(expr, targetWasmType) {
		const p = this._emitTimeDecomposeParts(expr);
		const yTmp = this.acquireTemp("i32");
		const mTmp = this.acquireTemp("i32");
		const dTmp = this.acquireTemp("i32");
		this._emitCivilDateFromDays(p.daysTmp, yTmp, mTmp, dTmp);
		this.pushInstruction({ op: "local.get", index: mTmp });
		if (targetWasmType === "i64") this.pushInstruction("i64.extend_i32_s");
		this.releaseTemp(dTmp, "i32");
		this.releaseTemp(mTmp, "i32");
		this.releaseTemp(yTmp, "i32");
		this._releaseTimeDecomposeParts(p);
	}

	_emitTimeMethodDay(expr, targetWasmType) {
		const p = this._emitTimeDecomposeParts(expr);
		const yTmp = this.acquireTemp("i32");
		const mTmp = this.acquireTemp("i32");
		const dTmp = this.acquireTemp("i32");
		this._emitCivilDateFromDays(p.daysTmp, yTmp, mTmp, dTmp);
		this.pushInstruction({ op: "local.get", index: dTmp });
		if (targetWasmType === "i64") this.pushInstruction("i64.extend_i32_s");
		this.releaseTemp(dTmp, "i32");
		this.releaseTemp(mTmp, "i32");
		this.releaseTemp(yTmp, "i32");
		this._releaseTimeDecomposeParts(p);
	}

	_releaseTimeDecomposeParts(p) {
		this.releaseTemp(p.nanoTmp, "i64");
		this.releaseTemp(p.offTmp, "i32");
		this.releaseTemp(p.remSecTmp, "i64");
		this.releaseTemp(p.daysTmp, "i64");
		this.releaseTemp(p.localSecTmp, "i64");
		this.releaseTemp(p.rTmp, p.timeW);
	}

	_emitTimeMethodFormat(expr, args, _targetWasmType) {
		const p = this._emitTimeDecomposeParts(expr);
		const layoutTmp = this.acquireTemp("externref");
		this.emitExpr(args[0], "externref");
		this.pushInstruction({ op: "local.set", index: layoutTmp });

		const yTmp = this.acquireTemp("i32");
		const mTmp = this.acquireTemp("i32");
		const dTmp = this.acquireTemp("i32");
		this._emitCivilDateFromDays(p.daysTmp, yTmp, mTmp, dTmp);

		// hr = remSec / 3600
		const hrTmp = this.acquireTemp("i32");
		this.pushInstruction({ op: "local.get", index: p.remSecTmp });
		this.pushInstruction({ op: "i64.const", value: 3600n });
		this.pushInstruction("i64.div_s");
		this.pushInstruction("i32.wrap_i64");
		this.pushInstruction({ op: "local.set", index: hrTmp });

		// min = (remSec % 3600) / 60
		const minTmp = this.acquireTemp("i32");
		this.pushInstruction({ op: "local.get", index: p.remSecTmp });
		this.pushInstruction({ op: "i64.const", value: 3600n });
		this.pushInstruction("i64.rem_s");
		this.pushInstruction({ op: "i64.const", value: 60n });
		this.pushInstruction("i64.div_s");
		this.pushInstruction("i32.wrap_i64");
		this.pushInstruction({ op: "local.set", index: minTmp });

		// sec = remSec % 60
		const secTmp = this.acquireTemp("i32");
		this.pushInstruction({ op: "local.get", index: p.remSecTmp });
		this.pushInstruction({ op: "i64.const", value: 60n });
		this.pushInstruction("i64.rem_s");
		this.pushInstruction("i32.wrap_i64");
		this.pushInstruction({ op: "local.set", index: secTmp });

		// wd = (days + 4) % 7
		const wdTmp = this.acquireTemp("i32");
		this.pushInstruction({ op: "local.get", index: p.daysTmp });
		this.pushInstruction({ op: "i64.const", value: 4n });
		this.pushInstruction("i64.add");
		this.pushInstruction({ op: "i64.const", value: 7n });
		this.pushInstruction("i64.rem_s");
		this.pushInstruction("i32.wrap_i64");
		this.pushInstruction({ op: "local.tee", index: wdTmp });
		this.pushInstruction({ op: "i32.const", value: 0 });
		this.pushInstruction("i32.lt_s");
		this.pushInstruction({ op: "if", blockType: "void" });
		this.pushInstruction({ op: "local.get", index: wdTmp });
		this.pushInstruction({ op: "i32.const", value: 7 });
		this.pushInstruction("i32.add");
		this.pushInstruction({ op: "local.set", index: wdTmp });
		this.pushInstruction("end");

		// ms = i32((nanoTmp % 1000000000n) / 1000000n)
		const msTmp = this.acquireTemp("i32");
		this.pushInstruction({ op: "local.get", index: p.nanoTmp });
		this.pushInstruction({ op: "i64.const", value: 1000000000n });
		this.pushInstruction("i64.rem_s");
		this.pushInstruction({ op: "i64.const", value: 1000000n });
		this.pushInstruction("i64.div_s");
		this.pushInstruction("i32.wrap_i64");
		this.pushInstruction({ op: "local.tee", index: msTmp });
		this.pushInstruction({ op: "i32.const", value: 0 });
		this.pushInstruction("i32.lt_s");
		this.pushInstruction({ op: "if", blockType: "void" });
		this.pushInstruction({ op: "local.get", index: msTmp });
		this.pushInstruction({ op: "i32.const", value: 1000 });
		this.pushInstruction("i32.add");
		this.pushInstruction({ op: "local.set", index: msTmp });
		this.pushInstruction("end");

		// Call time_format(y, m, d, hr, min, sec, wd, ms, off, layout)
		this.pushInstruction({ op: "local.get", index: yTmp });
		this.pushInstruction({ op: "local.get", index: mTmp });
		this.pushInstruction({ op: "local.get", index: dTmp });
		this.pushInstruction({ op: "local.get", index: hrTmp });
		this.pushInstruction({ op: "local.get", index: minTmp });
		this.pushInstruction({ op: "local.get", index: secTmp });
		this.pushInstruction({ op: "local.get", index: wdTmp });
		this.pushInstruction({ op: "local.get", index: msTmp });
		this.pushInstruction({ op: "local.get", index: p.offTmp });
		this.pushInstruction({ op: "local.get", index: layoutTmp });
		this._callStdlib("time_format");

		this.releaseTemp(msTmp, "i32");
		this.releaseTemp(wdTmp, "i32");
		this.releaseTemp(secTmp, "i32");
		this.releaseTemp(minTmp, "i32");
		this.releaseTemp(hrTmp, "i32");
		this.releaseTemp(dTmp, "i32");
		this.releaseTemp(mTmp, "i32");
		this.releaseTemp(yTmp, "i32");
		this.releaseTemp(layoutTmp, "externref");
		this._releaseTimeDecomposeParts(p);
	}

	_emitTimeMethodString(expr, targetWasmType) {
		const strLit = {
			kind: "BasicLit",
			litKind: "STRING",
			value: "2006-01-02T15:04:05Z07:00",
		};
		this._emitTimeMethodFormat(expr, [strLit], targetWasmType);
	}
}
