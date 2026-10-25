// src/backend/wasm/stdlib/time.js
// FunctionEmitter mixin: time package.

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

const TIME_INT_CONSTS = {
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
		const f = expr.field;
		return (
			this._isPkgExpr(expr, "time") &&
			(f in DURATION_VALS ||
				f in LAYOUT_STRS ||
				f in TIME_INT_CONSTS ||
				f === "UTC" ||
				f === "Local")
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
		if (field in TIME_INT_CONSTS) {
			const v = TIME_INT_CONSTS[field];
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
			case "ParseDuration":
				this._emitTimeParseDuration(call.args, targetWasmType);
				break;
			case "FixedZone":
				this._emitTimeFixedZone(call.args, targetWasmType);
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
			case "AddDate":
				this._emitTimeMethodAddDate(expr, args, targetWasmType);
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
			case "Compare":
				this._emitTimeMethodCompare(expr, args, targetWasmType);
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
				this._emitTimeMethodYMD(expr, targetWasmType, 0);
				break;
			case "Month":
				this._emitTimeMethodYMD(expr, targetWasmType, 1);
				break;
			case "Day":
				this._emitTimeMethodYMD(expr, targetWasmType, 2);
				break;
			case "YearDay":
				this._emitTimeMethodYearDay(expr, targetWasmType);
				break;
			case "ISOWeek":
				this._emitTimeMethodISOWeek(expr, targetWasmType);
				break;
			case "Zone":
				this._emitTimeMethodZone(expr, targetWasmType);
				break;
			case "Location":
				this._emitTimeMethodLocation(expr, targetWasmType);
				break;
			case "IsZero":
				this._emitTimeMethodIsZero(expr);
				break;
			case "UnixNano":
				this._emitTimeMethodUnixNano(expr, targetWasmType);
				break;
			case "Nanosecond":
				this._emitTimeMethodNanosecond(expr, targetWasmType);
				break;
			case "Truncate":
				this._emitTimeMethodTruncate(expr, args, targetWasmType);
				break;
			case "Round":
				this._emitTimeMethodRound(expr, args, targetWasmType);
				break;
			case "MarshalJSON":
				this._emitTimeMethodMarshalJSON(expr, targetWasmType);
				break;
			case "UnmarshalJSON":
				this._emitTimeMethodUnmarshalJSON(expr, args, targetWasmType);
				break;
			case "MarshalText":
				this._emitTimeMethodMarshalText(expr, targetWasmType);
				break;
			case "UnmarshalText":
				this._emitTimeMethodUnmarshalText(expr, args, targetWasmType);
				break;
			case "UTC":
				this._emitTimeMethodUTC(expr);
				break;
			case "Local":
				this._emitTimeMethodLocal(expr);
				break;
			default:
				throw new Error(`Unsupported time.Time method '${field}'`);
		}
	}

	emitDurationMethodCall(field, expr, args, _targetWasmType) {
		switch (field) {
			case "Nanoseconds":
				this.emitExpr(expr, "i64");
				return;
			case "Microseconds":
				this.emitExpr(expr, "i64");
				this.pushInstruction({ op: "i64.const", value: 1000n });
				this.pushInstruction("i64.div_s");
				return;
			case "Milliseconds":
				this.emitExpr(expr, "i64");
				this.pushInstruction({ op: "i64.const", value: 1000000n });
				this.pushInstruction("i64.div_s");
				return;
			case "Seconds":
				this.emitExpr(expr, "i64");
				this.pushInstruction("f64.convert_i64_s");
				this.pushInstruction({ op: "f64.const", value: 1000000000.0 });
				this.pushInstruction("f64.div");
				return;
			case "Minutes":
				this.emitExpr(expr, "i64");
				this.pushInstruction("f64.convert_i64_s");
				this.pushInstruction({ op: "f64.const", value: 60000000000.0 });
				this.pushInstruction("f64.div");
				return;
			case "Hours":
				this.emitExpr(expr, "i64");
				this.pushInstruction("f64.convert_i64_s");
				this.pushInstruction({ op: "f64.const", value: 3600000000000.0 });
				this.pushInstruction("f64.div");
				return;
			case "Truncate":
				this._emitDurationTruncate(expr, args);
				return;
			case "Round":
				this._emitDurationRound(expr, args);
				return;
			case "Abs":
				this._emitDurationAbs(expr);
				return;
			case "String":
				this.emitExpr(expr, "i64");
				this._callStdlib("time_duration_string");
				return;
			default:
				throw new Error(`Unsupported time.Duration method '${field}'`);
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
		this.pushInstruction("i64.trunc_sat_f64_s");
		this.pushInstruction({ op: "i64.const", value: 1000000n });
		this.pushInstruction("i64.mul");
		this.pushInstruction({ op: "local.get", index: offTmp });
		this.pushInstruction({ op: "ref.null", heapType: "any" });
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
		this.pushInstruction("i64.trunc_sat_f64_s");
		this.pushInstruction({ op: "i64.const", value: 1000000n });
		this.pushInstruction("i64.mul");
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
		this.pushInstruction({ op: "ref.null", heapType: "any" });
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
		this.pushInstruction({ op: "local.get", index: locTmp });
		this.pushInstruction("ref.is_null");
		this.pushInstruction({ op: "if", blockType: "void" });
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
		this.pushInstruction("else");
		const locInfo = this.mod.getStructType("time.Location");
		if (locInfo) {
			this.pushInstruction({ op: "local.get", index: locTmp });
			this.pushInstruction({
				op: "ref.cast",
				nullable: true,
				typeIndex: locInfo.typeIndex,
			});
			this.pushInstruction({
				op: "struct.get",
				typeIndex: locInfo.typeIndex,
				fieldIndex: 1,
			});
			this.pushInstruction("i32.wrap_i64");
			this.pushInstruction({ op: "local.set", index: offTmp });
		}
		this.pushInstruction("end");

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
		this.pushInstruction({ op: "local.get", index: locTmp });
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
		this.pushInstruction("i64.trunc_sat_f64_s");
		this.pushInstruction({ op: "i64.const", value: 1000000n });
		this.pushInstruction("i64.mul");
		this._callStdlib("time_parse_sub_ns");
		this.pushInstruction("i64.extend_i32_s");
		this.pushInstruction("i64.add");
		this.pushInstruction({ op: "local.get", index: offTmp });
		this.pushInstruction({ op: "ref.null", heapType: "any" });
		this.pushInstruction({ op: "struct.new", typeIndex: timeInfo.typeIndex });
		this.pushInstruction({ op: "local.set", index: resTimeTmp });
		this.pushInstruction({ op: "ref.null", heapType: "any" });
		this.pushInstruction({ op: "local.set", index: resErrTmp });

		this.pushInstruction("else");

		// Error
		this.pushInstruction({ op: "i64.const", value: 0n });
		this.pushInstruction({ op: "i32.const", value: 0 });
		this.pushInstruction({ op: "ref.null", heapType: "any" });
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

		this.pushInstruction({ op: "local.get", index: rTmp });
		this.pushInstruction({
			op: "struct.get",
			typeIndex: timeInfo.typeIndex,
			fieldIndex: 2,
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

	_emitTimeGetNano(expr) {
		const timeInfo = this.mod.getStructType("time.Time");
		this.emitExpr(expr, {
			kind: "ref",
			nullable: true,
			typeIndex: timeInfo.typeIndex,
		});
		this.pushInstruction({
			op: "struct.get",
			typeIndex: timeInfo.typeIndex,
			fieldIndex: 0,
		});
		return timeInfo;
	}

	_emitTimeMethodUnix(expr, targetWasmType) {
		this._emitTimeGetNano(expr);
		this.pushInstruction({ op: "i64.const", value: 1000000000n });
		this.pushInstruction("i64.div_s");
		if (targetWasmType === "i32") {
			this.pushInstruction("i32.wrap_i64");
		}
	}

	_emitTimeMethodUnixMilli(expr, targetWasmType) {
		this._emitTimeGetNano(expr);
		this.pushInstruction({ op: "i64.const", value: 1000000n });
		this.pushInstruction("i64.div_s");
		if (targetWasmType === "i32") {
			this.pushInstruction("i32.wrap_i64");
		}
	}

	_emitTimeMethodUnixNano(expr, targetWasmType) {
		this._emitTimeGetNano(expr);
		if (targetWasmType === "i32") {
			this.pushInstruction("i32.wrap_i64");
		}
	}

	_emitTimeMethodIsZero(expr) {
		this._emitTimeGetNano(expr);
		this.pushInstruction({ op: "i64.const", value: 0n });
		this.pushInstruction("i64.eq");
	}

	_emitTimeMethodNanosecond(expr, targetWasmType) {
		this._emitTimeGetNano(expr);
		this.pushInstruction({ op: "i64.const", value: 1000000000n });
		this.pushInstruction("i64.rem_s");
		const nsTmp = this.acquireTemp("i64");
		this.pushInstruction({ op: "local.tee", index: nsTmp });
		this.pushInstruction({ op: "i64.const", value: 0n });
		this.pushInstruction("i64.lt_s");
		this.pushInstruction({ op: "if", blockType: "i64" });
		this.pushInstruction({ op: "local.get", index: nsTmp });
		this.pushInstruction({ op: "i64.const", value: 1000000000n });
		this.pushInstruction("i64.add");
		this.pushInstruction({ op: "else" });
		this.pushInstruction({ op: "local.get", index: nsTmp });
		this.pushInstruction("end");
		this.releaseTemp(nsTmp, "i64");
		if (targetWasmType !== "i64") {
			this.pushInstruction("i32.wrap_i64");
		}
	}

	_emitTimeMethodUTC(expr) {
		const timeInfo = this._emitTimeGetNano(expr);
		this.pushInstruction({ op: "i32.const", value: 0 });
		this.pushInstruction({ op: "ref.null", heapType: "any" });
		this.pushInstruction({
			op: "struct.new",
			typeIndex: timeInfo.typeIndex,
		});
	}

	_emitTimeMethodLocal(expr) {
		const timeInfo = this.mod.getStructType("time.Time");
		const timeW = {
			kind: "ref",
			nullable: true,
			typeIndex: timeInfo.typeIndex,
		};
		const rTmp = this.acquireTemp(timeW);
		this.emitExpr(expr, timeW);
		this.pushInstruction({ op: "local.set", index: rTmp });

		this.pushInstruction({ op: "local.get", index: rTmp });
		this.pushInstruction({
			op: "struct.get",
			typeIndex: timeInfo.typeIndex,
			fieldIndex: 0,
		});

		this.pushInstruction({ op: "local.get", index: rTmp });
		this.pushInstruction({
			op: "struct.get",
			typeIndex: timeInfo.typeIndex,
			fieldIndex: 0,
		});
		this.pushInstruction({ op: "i64.const", value: 1000000n });
		this.pushInstruction("i64.div_s");
		this.pushInstruction("f64.convert_i64_s");
		this.pushInstruction({
			op: "call",
			funcIndex: this.mod.getTimezoneOffsetImportIndex(),
		});
		this.pushInstruction({ op: "ref.null", heapType: "any" });
		this.pushInstruction({
			op: "struct.new",
			typeIndex: timeInfo.typeIndex,
		});
		this.releaseTemp(rTmp, timeW);
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

	_emitTimeMethodYMD(expr, targetWasmType, partIdx) {
		const p = this._emitTimeDecomposeParts(expr);
		const yTmp = this.acquireTemp("i32");
		const mTmp = this.acquireTemp("i32");
		const dTmp = this.acquireTemp("i32");
		this._emitCivilDateFromDays(p.daysTmp, yTmp, mTmp, dTmp);
		this.pushInstruction({
			op: "local.get",
			index: partIdx === 0 ? yTmp : partIdx === 1 ? mTmp : dTmp,
		});
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

		// ns = i32(nanoTmp % 1000000000n)
		const msTmp = this.acquireTemp("i32");
		this.pushInstruction({ op: "local.get", index: p.nanoTmp });
		this.pushInstruction({ op: "i64.const", value: 1000000000n });
		this.pushInstruction("i64.rem_s");
		this.pushInstruction("i32.wrap_i64");
		this.pushInstruction({ op: "local.tee", index: msTmp });
		this.pushInstruction({ op: "i32.const", value: 0 });
		this.pushInstruction("i32.lt_s");
		this.pushInstruction({ op: "if", blockType: "void" });
		this.pushInstruction({ op: "local.get", index: msTmp });
		this.pushInstruction({ op: "i32.const", value: 1000000000 });
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

	_emitTimeParseDuration(args, _targetWasmType) {
		const durTmp = this.acquireTemp("i64");
		const errStrTmp = this.acquireTemp("externref");
		const resErrTmp = this.acquireTemp("anyref");

		this.emitExpr(args[0], "externref");
		this._callStdlib("time_parse_duration");
		this.pushInstruction({ op: "local.set", index: durTmp });
		this._callStdlib("time_parse_duration_err");
		this.pushInstruction({ op: "local.set", index: errStrTmp });

		this.pushInstruction({ op: "local.get", index: errStrTmp });
		this.pushInstruction("ref.is_null");
		this.pushInstruction({ op: "if", blockType: "void" });
		this.pushInstruction({ op: "ref.null", heapType: "any" });
		this.pushInstruction({ op: "local.set", index: resErrTmp });
		this.pushInstruction("else");
		this.pushInstruction({ op: "local.get", index: errStrTmp });
		this.pushInstruction({ op: "ref.null", heapType: "any" });
		this.pushInstruction({
			op: "call",
			funcIndex: this.mod.resolveFuncIndex("__mk_error"),
		});
		this.pushInstruction({ op: "local.set", index: resErrTmp });
		this.pushInstruction("end");

		this.pushInstruction({ op: "local.get", index: durTmp });
		this.pushInstruction({ op: "local.get", index: resErrTmp });

		this.releaseTemp(resErrTmp, "anyref");
		this.releaseTemp(errStrTmp, "externref");
		this.releaseTemp(durTmp, "i64");
	}

	_emitTimeFixedZone(args, _targetWasmType) {
		const locInfo = this.mod.getStructType("time.Location");
		this.emitExpr(args[0], "externref");
		this.emitExpr(args[1], "i64");
		this.pushInstruction({ op: "struct.new", typeIndex: locInfo.typeIndex });
	}

	_emitDurationAbs(expr) {
		const dTmp = this.acquireTemp("i64");
		this.emitExpr(expr, "i64");
		this.pushInstruction({ op: "local.tee", index: dTmp });
		this.pushInstruction({ op: "i64.const", value: 0n });
		this.pushInstruction("i64.ge_s");
		this.pushInstruction({ op: "if", blockType: "i64" });
		this.pushInstruction({ op: "local.get", index: dTmp });
		this.pushInstruction("else");
		this.pushInstruction({ op: "local.get", index: dTmp });
		this.pushInstruction({ op: "i64.const", value: -9223372036854775808n });
		this.pushInstruction("i64.eq");
		this.pushInstruction({ op: "if", blockType: "i64" });
		this.pushInstruction({ op: "i64.const", value: 9223372036854775807n });
		this.pushInstruction("else");
		this.pushInstruction({ op: "i64.const", value: 0n });
		this.pushInstruction({ op: "local.get", index: dTmp });
		this.pushInstruction("i64.sub");
		this.pushInstruction("end");
		this.pushInstruction("end");
		this.releaseTemp(dTmp, "i64");
	}

	_emitDurationTruncate(expr, args) {
		const dTmp = this.acquireTemp("i64");
		const mTmp = this.acquireTemp("i64");
		this.emitExpr(expr, "i64");
		this.pushInstruction({ op: "local.set", index: dTmp });
		this.emitExpr(args[0], "i64");
		this.pushInstruction({ op: "local.tee", index: mTmp });
		this.pushInstruction({ op: "i64.const", value: 0n });
		this.pushInstruction("i64.le_s");
		this.pushInstruction({ op: "if", blockType: "i64" });
		this.pushInstruction({ op: "local.get", index: dTmp });
		this.pushInstruction("else");
		this.pushInstruction({ op: "local.get", index: dTmp });
		this.pushInstruction({ op: "local.get", index: dTmp });
		this.pushInstruction({ op: "local.get", index: mTmp });
		this.pushInstruction("i64.rem_s");
		this.pushInstruction("i64.sub");
		this.pushInstruction("end");
		this.releaseTemp(mTmp, "i64");
		this.releaseTemp(dTmp, "i64");
	}

	_emitDurationRound(expr, args) {
		const dTmp = this.acquireTemp("i64");
		const mTmp = this.acquireTemp("i64");
		const rTmp = this.acquireTemp("i64");
		this.emitExpr(expr, "i64");
		this.pushInstruction({ op: "local.set", index: dTmp });
		this.emitExpr(args[0], "i64");
		this.pushInstruction({ op: "local.set", index: mTmp });

		this.pushInstruction({ op: "local.get", index: mTmp });
		this.pushInstruction({ op: "i64.const", value: 0n });
		this.pushInstruction("i64.le_s");
		this.pushInstruction({ op: "if", blockType: "i64" });
		this.pushInstruction({ op: "local.get", index: dTmp });
		this.pushInstruction("else");

		this.pushInstruction({ op: "local.get", index: dTmp });
		this.pushInstruction({ op: "local.get", index: mTmp });
		this.pushInstruction("i64.rem_s");
		this.pushInstruction({ op: "local.set", index: rTmp });

		this.pushInstruction({ op: "local.get", index: dTmp });
		this.pushInstruction({ op: "i64.const", value: 0n });
		this.pushInstruction("i64.lt_s");
		this.pushInstruction({ op: "if", blockType: "i64" });

		this.pushInstruction({ op: "i64.const", value: 0n });
		this.pushInstruction({ op: "local.get", index: rTmp });
		this.pushInstruction("i64.sub");
		this.pushInstruction({ op: "local.set", index: rTmp });

		this.pushInstruction({ op: "local.get", index: rTmp });
		this.pushInstruction({ op: "local.get", index: mTmp });
		this.pushInstruction({ op: "local.get", index: rTmp });
		this.pushInstruction("i64.sub");
		this.pushInstruction("i64.lt_u");
		this.pushInstruction({ op: "if", blockType: "i64" });
		this.pushInstruction({ op: "local.get", index: dTmp });
		this.pushInstruction({ op: "local.get", index: rTmp });
		this.pushInstruction("i64.add");
		this.pushInstruction("else");
		this.pushInstruction({ op: "local.get", index: dTmp });
		this.pushInstruction({ op: "local.get", index: mTmp });
		this.pushInstruction("i64.sub");
		this.pushInstruction({ op: "local.get", index: rTmp });
		this.pushInstruction("i64.add");
		this.pushInstruction("end");

		this.pushInstruction("else");

		this.pushInstruction({ op: "local.get", index: rTmp });
		this.pushInstruction({ op: "local.get", index: mTmp });
		this.pushInstruction({ op: "local.get", index: rTmp });
		this.pushInstruction("i64.sub");
		this.pushInstruction("i64.lt_u");
		this.pushInstruction({ op: "if", blockType: "i64" });
		this.pushInstruction({ op: "local.get", index: dTmp });
		this.pushInstruction({ op: "local.get", index: rTmp });
		this.pushInstruction("i64.sub");
		this.pushInstruction("else");
		this.pushInstruction({ op: "local.get", index: dTmp });
		this.pushInstruction({ op: "local.get", index: mTmp });
		this.pushInstruction("i64.add");
		this.pushInstruction({ op: "local.get", index: rTmp });
		this.pushInstruction("i64.sub");
		this.pushInstruction("end");

		this.pushInstruction("end");
		this.pushInstruction("end");

		this.releaseTemp(rTmp, "i64");
		this.releaseTemp(mTmp, "i64");
		this.releaseTemp(dTmp, "i64");
	}

	_emitTimeMethodCompare(expr, args, targetWasmType) {
		const timeInfo = this.mod.getStructType("time.Time");
		const timeW = {
			kind: "ref",
			nullable: true,
			typeIndex: timeInfo.typeIndex,
		};
		const tTmp = this.acquireTemp(timeW);
		const uTmp = this.acquireTemp(timeW);
		const tNano = this.acquireTemp("i64");
		const uNano = this.acquireTemp("i64");

		this.emitExpr(expr, timeW);
		this.pushInstruction({ op: "local.set", index: tTmp });
		this.emitExpr(args[0], timeW);
		this.pushInstruction({ op: "local.set", index: uTmp });

		this.pushInstruction({ op: "local.get", index: tTmp });
		this.pushInstruction({
			op: "struct.get",
			typeIndex: timeInfo.typeIndex,
			fieldIndex: 0,
		});
		this.pushInstruction({ op: "local.set", index: tNano });
		this.pushInstruction({ op: "local.get", index: uTmp });
		this.pushInstruction({
			op: "struct.get",
			typeIndex: timeInfo.typeIndex,
			fieldIndex: 0,
		});
		this.pushInstruction({ op: "local.set", index: uNano });

		this.pushInstruction({ op: "local.get", index: tNano });
		this.pushInstruction({ op: "local.get", index: uNano });
		this.pushInstruction("i64.lt_s");
		this.pushInstruction({ op: "if", blockType: "i32" });
		this.pushInstruction({ op: "i32.const", value: -1 });
		this.pushInstruction("else");
		this.pushInstruction({ op: "local.get", index: tNano });
		this.pushInstruction({ op: "local.get", index: uNano });
		this.pushInstruction("i64.gt_s");
		this.pushInstruction({ op: "if", blockType: "i32" });
		this.pushInstruction({ op: "i32.const", value: 1 });
		this.pushInstruction("else");
		this.pushInstruction({ op: "i32.const", value: 0 });
		this.pushInstruction("end");
		this.pushInstruction("end");

		this.releaseTemp(uNano, "i64");
		this.releaseTemp(tNano, "i64");
		this.releaseTemp(uTmp, timeW);
		this.releaseTemp(tTmp, timeW);

		if (targetWasmType === "i64") {
			this.pushInstruction("i64.extend_i32_s");
		}
	}

	_emitTimeMethodYearDay(expr, targetWasmType) {
		const p = this._emitTimeDecomposeParts(expr);
		const yTmp = this.acquireTemp("i32");
		const mTmp = this.acquireTemp("i32");
		const dTmp = this.acquireTemp("i32");
		this._emitCivilDateFromDays(p.daysTmp, yTmp, mTmp, dTmp);

		const jan1YTmp = this.acquireTemp("i32");
		const jan1MTmp = this.acquireTemp("i32");
		const jan1DTmp = this.acquireTemp("i32");
		const jan1DaysTmp = this.acquireTemp("i64");

		this.pushInstruction({ op: "local.get", index: yTmp });
		this.pushInstruction({ op: "local.set", index: jan1YTmp });
		this.pushInstruction({ op: "i32.const", value: 1 });
		this.pushInstruction({ op: "local.set", index: jan1MTmp });
		this.pushInstruction({ op: "i32.const", value: 1 });
		this.pushInstruction({ op: "local.set", index: jan1DTmp });
		this._emitCivilDays(jan1YTmp, jan1MTmp, jan1DTmp, jan1DaysTmp);

		this.pushInstruction({ op: "local.get", index: p.daysTmp });
		this.pushInstruction({ op: "local.get", index: jan1DaysTmp });
		this.pushInstruction("i64.sub");
		this.pushInstruction({ op: "i64.const", value: 1n });
		this.pushInstruction("i64.add");

		if (targetWasmType === "i32") {
			this.pushInstruction("i32.wrap_i64");
		}

		this.releaseTemp(jan1DaysTmp, "i64");
		this.releaseTemp(jan1DTmp, "i32");
		this.releaseTemp(jan1MTmp, "i32");
		this.releaseTemp(jan1YTmp, "i32");
		this.releaseTemp(dTmp, "i32");
		this.releaseTemp(mTmp, "i32");
		this.releaseTemp(yTmp, "i32");
		this._releaseTimeDecomposeParts(p);
	}

	_emitTimeMethodISOWeek(expr, targetWasmType) {
		const p = this._emitTimeDecomposeParts(expr);
		const monOffsetTmp = this.acquireTemp("i32");
		const thuDaysTmp = this.acquireTemp("i64");
		this.pushInstruction({ op: "local.get", index: p.daysTmp });
		this.pushInstruction({ op: "i64.const", value: 3n });
		this.pushInstruction("i64.add");
		this.pushInstruction({ op: "i64.const", value: 7n });
		this.pushInstruction("i64.rem_s");
		this.pushInstruction("i32.wrap_i64");
		this.pushInstruction({ op: "local.tee", index: monOffsetTmp });
		this.pushInstruction({ op: "i32.const", value: 0 });
		this.pushInstruction("i32.lt_s");
		this.pushInstruction({ op: "if", blockType: "void" });
		this.pushInstruction({ op: "local.get", index: monOffsetTmp });
		this.pushInstruction({ op: "i32.const", value: 7 });
		this.pushInstruction("i32.add");
		this.pushInstruction({ op: "local.set", index: monOffsetTmp });
		this.pushInstruction("end");

		this.pushInstruction({ op: "local.get", index: p.daysTmp });
		this.pushInstruction({ op: "local.get", index: monOffsetTmp });
		this.pushInstruction("i64.extend_i32_s");
		this.pushInstruction("i64.sub");
		this.pushInstruction({ op: "i64.const", value: 3n });
		this.pushInstruction("i64.add");
		this.pushInstruction({ op: "local.set", index: thuDaysTmp });

		const isoYearTmp = this.acquireTemp("i32");
		const dummyMTmp = this.acquireTemp("i32");
		const dummyDTmp = this.acquireTemp("i32");
		this._emitCivilDateFromDays(thuDaysTmp, isoYearTmp, dummyMTmp, dummyDTmp);
		this.releaseTemp(dummyDTmp, "i32");
		this.releaseTemp(dummyMTmp, "i32");

		const jan4YTmp = this.acquireTemp("i32");
		const jan4MTmp = this.acquireTemp("i32");
		const jan4DTmp = this.acquireTemp("i32");
		const jan4DaysTmp = this.acquireTemp("i64");
		this.pushInstruction({ op: "local.get", index: isoYearTmp });
		this.pushInstruction({ op: "local.set", index: jan4YTmp });
		this.pushInstruction({ op: "i32.const", value: 1 });
		this.pushInstruction({ op: "local.set", index: jan4MTmp });
		this.pushInstruction({ op: "i32.const", value: 4 });
		this.pushInstruction({ op: "local.set", index: jan4DTmp });
		this._emitCivilDays(jan4YTmp, jan4MTmp, jan4DTmp, jan4DaysTmp);
		this.releaseTemp(jan4DTmp, "i32");
		this.releaseTemp(jan4MTmp, "i32");
		this.releaseTemp(jan4YTmp, "i32");

		const jan4MonOffTmp = this.acquireTemp("i32");
		const firstThuDaysTmp = this.acquireTemp("i64");
		this.pushInstruction({ op: "local.get", index: jan4DaysTmp });
		this.pushInstruction({ op: "i64.const", value: 3n });
		this.pushInstruction("i64.add");
		this.pushInstruction({ op: "i64.const", value: 7n });
		this.pushInstruction("i64.rem_s");
		this.pushInstruction("i32.wrap_i64");
		this.pushInstruction({ op: "local.tee", index: jan4MonOffTmp });
		this.pushInstruction({ op: "i32.const", value: 0 });
		this.pushInstruction("i32.lt_s");
		this.pushInstruction({ op: "if", blockType: "void" });
		this.pushInstruction({ op: "local.get", index: jan4MonOffTmp });
		this.pushInstruction({ op: "i32.const", value: 7 });
		this.pushInstruction("i32.add");
		this.pushInstruction({ op: "local.set", index: jan4MonOffTmp });
		this.pushInstruction("end");

		this.pushInstruction({ op: "local.get", index: jan4DaysTmp });
		this.pushInstruction({ op: "local.get", index: jan4MonOffTmp });
		this.pushInstruction("i64.extend_i32_s");
		this.pushInstruction("i64.sub");
		this.pushInstruction({ op: "i64.const", value: 3n });
		this.pushInstruction("i64.add");
		this.pushInstruction({ op: "local.set", index: firstThuDaysTmp });

		const weekTmp = this.acquireTemp("i32");
		this.pushInstruction({ op: "local.get", index: thuDaysTmp });
		this.pushInstruction({ op: "local.get", index: firstThuDaysTmp });
		this.pushInstruction("i64.sub");
		this.pushInstruction({ op: "i64.const", value: 7n });
		this.pushInstruction("i64.div_s");
		this.pushInstruction("i32.wrap_i64");
		this.pushInstruction({ op: "i32.const", value: 1 });
		this.pushInstruction("i32.add");
		this.pushInstruction({ op: "local.set", index: weekTmp });

		this.pushInstruction({ op: "local.get", index: isoYearTmp });
		this.pushInstruction("i64.extend_i32_s");
		if (targetWasmType === "i32") this.pushInstruction("i32.wrap_i64");
		this.pushInstruction({ op: "local.get", index: weekTmp });
		this.pushInstruction("i64.extend_i32_s");
		if (targetWasmType === "i32") this.pushInstruction("i32.wrap_i64");

		this.releaseTemp(weekTmp, "i32");
		this.releaseTemp(firstThuDaysTmp, "i64");
		this.releaseTemp(jan4MonOffTmp, "i32");
		this.releaseTemp(jan4DaysTmp, "i64");
		this.releaseTemp(isoYearTmp, "i32");
		this.releaseTemp(thuDaysTmp, "i64");
		this.releaseTemp(monOffsetTmp, "i32");
		this._releaseTimeDecomposeParts(p);
	}

	_emitTimeMethodZone(expr, targetWasmType) {
		const timeInfo = this.mod.getStructType("time.Time");
		const timeW = {
			kind: "ref",
			nullable: true,
			typeIndex: timeInfo.typeIndex,
		};
		const rTmp = this.acquireTemp(timeW);
		const offTmp = this.acquireTemp("i32");
		const locTmp = this.acquireTemp("anyref");
		this.emitExpr(expr, timeW);
		this.pushInstruction({ op: "local.tee", index: rTmp });
		this.pushInstruction({
			op: "struct.get",
			typeIndex: timeInfo.typeIndex,
			fieldIndex: 1,
		});
		this.pushInstruction({ op: "local.set", index: offTmp });

		this.pushInstruction({ op: "local.get", index: rTmp });
		this.pushInstruction({
			op: "struct.get",
			typeIndex: timeInfo.typeIndex,
			fieldIndex: 2,
		});
		this.pushInstruction({ op: "local.tee", index: locTmp });
		this.pushInstruction("ref.is_null");
		this.pushInstruction({ op: "if", blockType: "externref" });

		this.pushInstruction({ op: "local.get", index: offTmp });
		this.pushInstruction({ op: "i32.const", value: 0 });
		this.pushInstruction("i32.eq");
		this.pushInstruction({ op: "if", blockType: "externref" });
		this.emitBasicLit(
			{ kind: "BasicLit", litKind: "STRING", value: "UTC" },
			"externref",
		);
		this.pushInstruction("else");
		this.emitBasicLit(
			{ kind: "BasicLit", litKind: "STRING", value: "LOCAL" },
			"externref",
		);
		this.pushInstruction("end");

		this.pushInstruction("else");
		const locInfo = this.mod.getStructType("time.Location");
		this.pushInstruction({ op: "local.get", index: locTmp });
		this.pushInstruction({
			op: "ref.cast",
			nullable: true,
			typeIndex: locInfo.typeIndex,
		});
		this.pushInstruction({
			op: "struct.get",
			typeIndex: locInfo.typeIndex,
			fieldIndex: 0,
		});
		this.pushInstruction("end");

		this.pushInstruction({ op: "local.get", index: offTmp });
		this.pushInstruction("i64.extend_i32_s");
		if (targetWasmType === "i32") {
			this.pushInstruction("i32.wrap_i64");
		}

		this.releaseTemp(locTmp, "anyref");
		this.releaseTemp(offTmp, "i32");
		this.releaseTemp(rTmp, timeW);
	}

	_emitTimeMethodLocation(expr, _targetWasmType) {
		const timeInfo = this.mod.getStructType("time.Time");
		const locInfo = this.mod.getStructType("time.Location");
		const timeW = {
			kind: "ref",
			nullable: true,
			typeIndex: timeInfo.typeIndex,
		};
		const rTmp = this.acquireTemp(timeW);
		const offTmp = this.acquireTemp("i32");
		const locTmp = this.acquireTemp("anyref");

		this.emitExpr(expr, timeW);
		this.pushInstruction({ op: "local.tee", index: rTmp });
		this.pushInstruction({
			op: "struct.get",
			typeIndex: timeInfo.typeIndex,
			fieldIndex: 2,
		});
		this.pushInstruction({ op: "local.tee", index: locTmp });
		this.pushInstruction("ref.is_null");
		this.pushInstruction({
			op: "if",
			blockType: { kind: "ref", nullable: true, typeIndex: locInfo.typeIndex },
		});

		this.pushInstruction({ op: "local.get", index: rTmp });
		this.pushInstruction({
			op: "struct.get",
			typeIndex: timeInfo.typeIndex,
			fieldIndex: 1,
		});
		this.pushInstruction({ op: "local.set", index: offTmp });

		this.pushInstruction({ op: "local.get", index: offTmp });
		this.pushInstruction({ op: "i32.const", value: 0 });
		this.pushInstruction("i32.eq");
		this.pushInstruction({ op: "if", blockType: "externref" });
		this.emitBasicLit(
			{ kind: "BasicLit", litKind: "STRING", value: "UTC" },
			"externref",
		);
		this.pushInstruction("else");
		this.emitBasicLit(
			{ kind: "BasicLit", litKind: "STRING", value: "Local" },
			"externref",
		);
		this.pushInstruction("end");

		this.pushInstruction({ op: "local.get", index: offTmp });
		this.pushInstruction("i64.extend_i32_s");

		this.pushInstruction({ op: "struct.new", typeIndex: locInfo.typeIndex });

		this.pushInstruction("else");
		this.pushInstruction({ op: "local.get", index: locTmp });
		this.pushInstruction({
			op: "ref.cast",
			nullable: true,
			typeIndex: locInfo.typeIndex,
		});
		this.pushInstruction("end");

		this.releaseTemp(locTmp, "anyref");
		this.releaseTemp(offTmp, "i32");
		this.releaseTemp(rTmp, timeW);
	}

	_emitTimeMethodTruncate(expr, args, _targetWasmType) {
		const timeInfo = this.mod.getStructType("time.Time");
		const timeW = {
			kind: "ref",
			nullable: true,
			typeIndex: timeInfo.typeIndex,
		};
		const rTmp = this.acquireTemp(timeW);
		const dTmp = this.acquireTemp("i64");
		const nanoTmp = this.acquireTemp("i64");
		const remTmp = this.acquireTemp("i64");
		const resNanoTmp = this.acquireTemp("i64");

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
		this.pushInstruction({ op: "local.set", index: nanoTmp });

		this.pushInstruction({ op: "local.get", index: dTmp });
		this.pushInstruction({ op: "i64.const", value: 0n });
		this.pushInstruction("i64.le_s");
		this.pushInstruction({ op: "if", blockType: "void" });
		this.pushInstruction({ op: "local.get", index: nanoTmp });
		this.pushInstruction({ op: "local.set", index: resNanoTmp });
		this.pushInstruction("else");
		this.pushInstruction({ op: "local.get", index: nanoTmp });
		this.pushInstruction({ op: "local.get", index: dTmp });
		this.pushInstruction("i64.rem_s");
		this.pushInstruction({ op: "local.tee", index: remTmp });
		this.pushInstruction({ op: "i64.const", value: 0n });
		this.pushInstruction("i64.lt_s");
		this.pushInstruction({ op: "if", blockType: "void" });
		this.pushInstruction({ op: "local.get", index: remTmp });
		this.pushInstruction({ op: "local.get", index: dTmp });
		this.pushInstruction("i64.add");
		this.pushInstruction({ op: "local.set", index: remTmp });
		this.pushInstruction("end");
		this.pushInstruction({ op: "local.get", index: nanoTmp });
		this.pushInstruction({ op: "local.get", index: remTmp });
		this.pushInstruction("i64.sub");
		this.pushInstruction({ op: "local.set", index: resNanoTmp });
		this.pushInstruction("end");

		this.pushInstruction({ op: "local.get", index: resNanoTmp });
		this.pushInstruction({ op: "local.get", index: rTmp });
		this.pushInstruction({
			op: "struct.get",
			typeIndex: timeInfo.typeIndex,
			fieldIndex: 1,
		});
		this.pushInstruction({ op: "local.get", index: rTmp });
		this.pushInstruction({
			op: "struct.get",
			typeIndex: timeInfo.typeIndex,
			fieldIndex: 2,
		});
		this.pushInstruction({ op: "struct.new", typeIndex: timeInfo.typeIndex });

		this.releaseTemp(resNanoTmp, "i64");
		this.releaseTemp(remTmp, "i64");
		this.releaseTemp(nanoTmp, "i64");
		this.releaseTemp(dTmp, "i64");
		this.releaseTemp(rTmp, timeW);
	}

	_emitTimeMethodRound(expr, args, _targetWasmType) {
		const timeInfo = this.mod.getStructType("time.Time");
		const timeW = {
			kind: "ref",
			nullable: true,
			typeIndex: timeInfo.typeIndex,
		};
		const rTmp = this.acquireTemp(timeW);
		const dTmp = this.acquireTemp("i64");
		const nanoTmp = this.acquireTemp("i64");
		const remTmp = this.acquireTemp("i64");
		const resNanoTmp = this.acquireTemp("i64");

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
		this.pushInstruction({ op: "local.set", index: nanoTmp });

		this.pushInstruction({ op: "local.get", index: dTmp });
		this.pushInstruction({ op: "i64.const", value: 0n });
		this.pushInstruction("i64.le_s");
		this.pushInstruction({ op: "if", blockType: "void" });
		this.pushInstruction({ op: "local.get", index: nanoTmp });
		this.pushInstruction({ op: "local.set", index: resNanoTmp });
		this.pushInstruction("else");
		this.pushInstruction({ op: "local.get", index: nanoTmp });
		this.pushInstruction({ op: "local.get", index: dTmp });
		this.pushInstruction("i64.rem_s");
		this.pushInstruction({ op: "local.tee", index: remTmp });
		this.pushInstruction({ op: "i64.const", value: 0n });
		this.pushInstruction("i64.lt_s");
		this.pushInstruction({ op: "if", blockType: "void" });
		this.pushInstruction({ op: "local.get", index: remTmp });
		this.pushInstruction({ op: "local.get", index: dTmp });
		this.pushInstruction("i64.add");
		this.pushInstruction({ op: "local.set", index: remTmp });
		this.pushInstruction("end");

		this.pushInstruction({ op: "local.get", index: remTmp });
		this.pushInstruction({ op: "local.get", index: dTmp });
		this.pushInstruction({ op: "local.get", index: remTmp });
		this.pushInstruction("i64.sub");
		this.pushInstruction("i64.lt_u");
		this.pushInstruction({ op: "if", blockType: "void" });
		this.pushInstruction({ op: "local.get", index: nanoTmp });
		this.pushInstruction({ op: "local.get", index: remTmp });
		this.pushInstruction("i64.sub");
		this.pushInstruction({ op: "local.set", index: resNanoTmp });
		this.pushInstruction("else");
		this.pushInstruction({ op: "local.get", index: nanoTmp });
		this.pushInstruction({ op: "local.get", index: dTmp });
		this.pushInstruction("i64.add");
		this.pushInstruction({ op: "local.get", index: remTmp });
		this.pushInstruction("i64.sub");
		this.pushInstruction({ op: "local.set", index: resNanoTmp });
		this.pushInstruction("end");
		this.pushInstruction("end");

		this.pushInstruction({ op: "local.get", index: resNanoTmp });
		this.pushInstruction({ op: "local.get", index: rTmp });
		this.pushInstruction({
			op: "struct.get",
			typeIndex: timeInfo.typeIndex,
			fieldIndex: 1,
		});
		this.pushInstruction({ op: "local.get", index: rTmp });
		this.pushInstruction({
			op: "struct.get",
			typeIndex: timeInfo.typeIndex,
			fieldIndex: 2,
		});
		this.pushInstruction({ op: "struct.new", typeIndex: timeInfo.typeIndex });

		this.releaseTemp(resNanoTmp, "i64");
		this.releaseTemp(remTmp, "i64");
		this.releaseTemp(nanoTmp, "i64");
		this.releaseTemp(dTmp, "i64");
		this.releaseTemp(rTmp, timeW);
	}

	_emitTimeMethodAddDate(expr, args, _targetWasmType) {
		const timeInfo = this.mod.getStructType("time.Time");
		const p = this._emitTimeDecomposeParts(expr);

		const yearsTmp = this.acquireTemp("i32");
		const monthsTmp = this.acquireTemp("i32");
		const daysAddTmp = this.acquireTemp("i32");
		this.emitExpr(args[0], "i32");
		this.pushInstruction({ op: "local.set", index: yearsTmp });
		this.emitExpr(args[1], "i32");
		this.pushInstruction({ op: "local.set", index: monthsTmp });
		this.emitExpr(args[2], "i32");
		this.pushInstruction({ op: "local.set", index: daysAddTmp });

		const curY = this.acquireTemp("i32");
		const curM = this.acquireTemp("i32");
		const curD = this.acquireTemp("i32");
		this._emitCivilDateFromDays(p.daysTmp, curY, curM, curD);

		this.pushInstruction({ op: "local.get", index: curY });
		this.pushInstruction({ op: "local.get", index: yearsTmp });
		this.pushInstruction("i32.add");
		this.pushInstruction({ op: "local.set", index: curY });

		this.pushInstruction({ op: "local.get", index: curM });
		this.pushInstruction({ op: "local.get", index: monthsTmp });
		this.pushInstruction("i32.add");
		this.pushInstruction({ op: "local.set", index: curM });

		this.pushInstruction({ op: "local.get", index: curD });
		this.pushInstruction({ op: "local.get", index: daysAddTmp });
		this.pushInstruction("i32.add");
		this.pushInstruction({ op: "local.set", index: curD });

		const newDaysTmp = this.acquireTemp("i64");
		this._emitCivilDays(curY, curM, curD, newDaysTmp);

		const newLocalSecTmp = this.acquireTemp("i64");
		this.pushInstruction({ op: "local.get", index: newDaysTmp });
		this.pushInstruction({ op: "i64.const", value: 86400n });
		this.pushInstruction("i64.mul");
		this.pushInstruction({ op: "local.get", index: p.remSecTmp });
		this.pushInstruction("i64.add");
		this.pushInstruction({ op: "local.set", index: newLocalSecTmp });

		const nsecTmp = this.acquireTemp("i64");
		this.pushInstruction({ op: "local.get", index: p.nanoTmp });
		this.pushInstruction({ op: "i64.const", value: 1000000000n });
		this.pushInstruction("i64.rem_s");
		this.pushInstruction({ op: "local.tee", index: nsecTmp });
		this.pushInstruction({ op: "i64.const", value: 0n });
		this.pushInstruction("i64.lt_s");
		this.pushInstruction({ op: "if", blockType: "void" });
		this.pushInstruction({ op: "local.get", index: nsecTmp });
		this.pushInstruction({ op: "i64.const", value: 1000000000n });
		this.pushInstruction("i64.add");
		this.pushInstruction({ op: "local.set", index: nsecTmp });
		this.pushInstruction("end");

		this.pushInstruction({ op: "local.get", index: newLocalSecTmp });
		this.pushInstruction({ op: "local.get", index: p.offTmp });
		this.pushInstruction("i64.extend_i32_s");
		this.pushInstruction("i64.sub");
		this.pushInstruction({ op: "i64.const", value: 1000000000n });
		this.pushInstruction("i64.mul");
		this.pushInstruction({ op: "local.get", index: nsecTmp });
		this.pushInstruction("i64.add");

		this.pushInstruction({ op: "local.get", index: p.offTmp });
		this.pushInstruction({ op: "local.get", index: p.rTmp });
		this.pushInstruction({
			op: "struct.get",
			typeIndex: timeInfo.typeIndex,
			fieldIndex: 2,
		});
		this.pushInstruction({ op: "struct.new", typeIndex: timeInfo.typeIndex });

		this.releaseTemp(nsecTmp, "i64");
		this.releaseTemp(newLocalSecTmp, "i64");
		this.releaseTemp(newDaysTmp, "i64");
		this.releaseTemp(curD, "i32");
		this.releaseTemp(curM, "i32");
		this.releaseTemp(curY, "i32");
		this.releaseTemp(daysAddTmp, "i32");
		this.releaseTemp(monthsTmp, "i32");
		this.releaseTemp(yearsTmp, "i32");
		this._releaseTimeDecomposeParts(p);
	}

	_emitTimeMethodMarshalText(expr, _targetWasmType) {
		const rfcLit = {
			kind: "BasicLit",
			litKind: "STRING",
			value: "2006-01-02T15:04:05.999999999Z07:00",
		};
		this._emitTimeMethodFormat(expr, [rfcLit], "externref");
		this._emitStringToByteSlice({ elem: { kind: "basic", name: "byte" } });
		this.pushInstruction({ op: "ref.null", heapType: "any" });
	}

	_emitTimeMethodMarshalJSON(expr, _targetWasmType) {
		const rfcLit = {
			kind: "BasicLit",
			litKind: "STRING",
			value: "2006-01-02T15:04:05.999999999Z07:00",
		};
		this._emitTimeMethodFormat(expr, [rfcLit], "externref");
		const strTmp = this.acquireTemp("externref");
		this.pushInstruction({ op: "local.set", index: strTmp });
		const qLit = { kind: "BasicLit", litKind: "STRING", value: '"' };
		this.emitBasicLit(qLit, "externref");
		this.pushInstruction({ op: "local.get", index: strTmp });
		this.pushInstruction({
			op: "call",
			funcIndex: this.mod.getStringConcatImportIndex(),
		});
		this.emitBasicLit(qLit, "externref");
		this.pushInstruction({
			op: "call",
			funcIndex: this.mod.getStringConcatImportIndex(),
		});
		this.releaseTemp(strTmp, "externref");
		this._emitStringToByteSlice({ elem: { kind: "basic", name: "byte" } });
		this.pushInstruction({ op: "ref.null", heapType: "any" });
	}

	_emitTimeMethodUnmarshalText(expr, args, _targetWasmType) {
		this._emitTimeMethodUnmarshalCore(expr, args[0]);
	}

	_emitTimeMethodUnmarshalJSON(expr, args, _targetWasmType) {
		this._emitTimeMethodUnmarshalCore(expr, args[0]);
	}

	_emitTimeMethodUnmarshalCore(expr, dataArg) {
		const timeInfo = this.mod.getStructType("time.Time");
		const timeW = {
			kind: "ref",
			nullable: true,
			typeIndex: timeInfo.typeIndex,
		};
		const rTmp = this.acquireTemp(timeW);
		this.emitExpr(expr, timeW);
		this.pushInstruction({ op: "local.set", index: rTmp });

		const byteSliceGo = dataArg._type ?? this._resolveExprGoType(dataArg);
		this.emitExpr(dataArg, this.toWasmType(byteSliceGo));
		this._emitByteSliceToString(byteSliceGo);

		const strTmp = this.acquireTemp("externref");
		this.pushInstruction({ op: "local.set", index: strTmp });

		const rfcLit = {
			kind: "BasicLit",
			litKind: "STRING",
			value: "2006-01-02T15:04:05.999999999Z07:00",
		};
		this.emitBasicLit(rfcLit, "externref");
		this.pushInstruction({ op: "local.get", index: strTmp });
		this._callStdlib("time_parse");

		const msTmp = this.acquireTemp("f64");
		const offTmp = this.acquireTemp("i32");
		const errStrTmp = this.acquireTemp("externref");
		const resErrTmp = this.acquireTemp("anyref");

		this.pushInstruction({ op: "local.set", index: msTmp });
		this._callStdlib("time_parse_offset");
		this.pushInstruction({ op: "local.set", index: offTmp });
		this._callStdlib("time_parse_err");
		this.pushInstruction({ op: "local.set", index: errStrTmp });

		this.pushInstruction({ op: "local.get", index: errStrTmp });
		this.pushInstruction("ref.is_null");
		this.pushInstruction({ op: "if", blockType: "void" });

		this.pushInstruction({ op: "local.get", index: rTmp });
		this.pushInstruction({ op: "local.get", index: msTmp });
		this.pushInstruction("i64.trunc_sat_f64_s");
		this.pushInstruction({ op: "i64.const", value: 1000000n });
		this.pushInstruction("i64.mul");
		this._callStdlib("time_parse_sub_ns");
		this.pushInstruction("i64.extend_i32_s");
		this.pushInstruction("i64.add");
		this.pushInstruction({
			op: "struct.set",
			typeIndex: timeInfo.typeIndex,
			fieldIndex: 0,
		});

		this.pushInstruction({ op: "local.get", index: rTmp });
		this.pushInstruction({ op: "local.get", index: offTmp });
		this.pushInstruction({
			op: "struct.set",
			typeIndex: timeInfo.typeIndex,
			fieldIndex: 1,
		});

		this.pushInstruction({ op: "local.get", index: rTmp });
		this.pushInstruction({ op: "ref.null", heapType: "any" });
		this.pushInstruction({
			op: "struct.set",
			typeIndex: timeInfo.typeIndex,
			fieldIndex: 2,
		});

		this.pushInstruction({ op: "ref.null", heapType: "any" });
		this.pushInstruction({ op: "local.set", index: resErrTmp });

		this.pushInstruction("else");

		this.pushInstruction({ op: "local.get", index: errStrTmp });
		this.pushInstruction({ op: "ref.null", heapType: "any" });
		this.pushInstruction({
			op: "call",
			funcIndex: this.mod.resolveFuncIndex("__mk_error"),
		});
		this.pushInstruction({ op: "local.set", index: resErrTmp });

		this.pushInstruction("end");

		this.pushInstruction({ op: "local.get", index: resErrTmp });

		this.releaseTemp(resErrTmp, "anyref");
		this.releaseTemp(errStrTmp, "externref");
		this.releaseTemp(offTmp, "i32");
		this.releaseTemp(msTmp, "f64");
		this.releaseTemp(strTmp, "externref");
		this.releaseTemp(rTmp, timeW);
	}

	emitTimeAuxMethodCall(recvTypeName, field, expr, _args, _targetWasmType) {
		if (field === "String") {
			if (recvTypeName === "time.Month") {
				this.emitExpr(expr, "i32");
				this._callStdlib("time_month_string");
				return;
			}
			if (recvTypeName === "time.Weekday") {
				this.emitExpr(expr, "i32");
				this._callStdlib("time_weekday_string");
				return;
			}
			if (recvTypeName === "time.Location") {
				const locInfo = this.mod.getStructType("time.Location");
				const locTmp = this.acquireTemp({
					kind: "ref",
					nullable: true,
					typeIndex: locInfo.typeIndex,
				});
				this.emitExpr(expr, {
					kind: "ref",
					nullable: true,
					typeIndex: locInfo.typeIndex,
				});
				this.pushInstruction({ op: "local.tee", index: locTmp });
				this.pushInstruction("ref.is_null");
				this.pushInstruction({ op: "if", blockType: "externref" });
				this.emitBasicLit(
					{ kind: "BasicLit", litKind: "STRING", value: "UTC" },
					"externref",
				);
				this.pushInstruction("else");
				this.pushInstruction({ op: "local.get", index: locTmp });
				this.pushInstruction({
					op: "struct.get",
					typeIndex: locInfo.typeIndex,
					fieldIndex: 0,
				});
				this.pushInstruction("end");
				this.releaseTemp(locTmp, {
					kind: "ref",
					nullable: true,
					typeIndex: locInfo.typeIndex,
				});
				return;
			}
		}
		throw new Error(`Unsupported method ${recvTypeName}.${field}`);
	}
}
