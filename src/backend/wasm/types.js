// src/backend/wasm/types.js
// Maps GoFront types to WasmGC types and manages type registry.

// `*testing.T` is a JS-side object (the harness's __GoFront_T) passed through
// the boundary as an opaque externref.
export function isTestingT(goType) {
	if (!goType) return false;
	const base =
		goType.kind === "pointer" || goType.kind === "PointerType"
			? goType.base
			: goType.kind === "StarExpr"
				? (goType.expr ?? goType.operand)
				: null;
	return base?.name === "testing.T";
}

export function toWasmType(goType, checker = null, mod = null) {
	if (!goType) return "i32";
	if (isTestingT(goType)) return "externref";

	// Pointer AST nodes
	if (goType.kind === "PointerType") {
		return toWasmType({ kind: "pointer", base: goType.base }, checker, mod);
	}
	if (goType.kind === "StarExpr") {
		return toWasmType(
			{ kind: "pointer", base: goType.expr ?? goType.operand },
			checker,
			mod,
		);
	}

	// Slice and Array AST nodes
	if (goType.kind === "SliceType") {
		return toWasmType({ kind: "slice", elem: goType.elem }, checker, mod);
	}
	if (goType.kind === "ArrayType") {
		return toWasmType({ kind: "array", elem: goType.elem }, checker, mod);
	}

	// TypeName AST node
	if (goType.kind === "TypeName" || goType.kind === "Ident") {
		if (mod?.getStructType(goType.name)) {
			return {
				kind: "ref",
				nullable: true,
				typeIndex: mod.getStructType(goType.name).typeIndex,
			};
		}
		const resolved = checker?.types?.get(goType.name);
		if (resolved) {
			return toWasmType(resolved, checker, mod);
		}
		return toWasmType({ kind: "basic", name: goType.name }, checker, mod);
	}

	// Unwrap named types
	if (goType.kind === "named") {
		if (mod?.getStructType(goType.name)) {
			return {
				kind: "ref",
				nullable: true,
				typeIndex: mod.getStructType(goType.name).typeIndex,
			};
		}
		if (goType.underlying) {
			return toWasmType(goType.underlying, checker, mod);
		}
	}

	// Untyped constants
	if (goType.kind === "untyped") {
		switch (goType.base) {
			case "int":
				return "i64"; // Default Go integer is int (i64 in WASM subset)
			case "float64":
				return "f64";
			case "string":
				return "externref";
			case "bool":
				return "i32";
			default:
				return "i64";
		}
	}

	if (goType.kind === "basic") {
		switch (goType.name) {
			case "bool":
			case "int8":
			case "int16":
			case "int32":
			case "uint8":
			case "uint16":
			case "uint32":
			case "byte":
			case "rune":
				return "i32";

			case "int":
			case "uint":
			case "int64":
			case "uint64":
			case "uintptr":
				return "i64";

			case "float32":
				return "f32";

			case "float64":
				return "f64";

			case "string":
				return "externref";

			case "any":
				return "anyref";

			case "void":
				return null;

			default:
				return "i64";
		}
	}

	if (goType.kind === "pointer") {
		// Struct pointer or boxed scalar
		if (goType.base) {
			const baseWType = toWasmType(goType.base, checker, mod);
			if (
				typeof baseWType === "object" &&
				baseWType !== null &&
				baseWType.kind === "ref"
			) {
				return baseWType;
			}
			if (mod?.getBoxType) {
				const box = mod.getBoxType(goType.base);
				if (box)
					return { kind: "ref", nullable: true, typeIndex: box.typeIndex };
			}
		}
		return { kind: "ref", nullable: true, heapType: "any" };
	}

	if (goType.kind === "slice") {
		if (mod?.getSliceType && goType.elem) {
			const sliceInfo = mod.getSliceType(goType.elem);
			return {
				kind: "ref",
				nullable: true,
				typeIndex: sliceInfo.typeIndex,
			};
		}
		return { kind: "ref", nullable: true, heapType: "struct" };
	}

	if (goType.kind === "array") {
		if (mod?.getArrayType && goType.elem) {
			const arrInfo = mod.getArrayType(goType.elem);
			return {
				kind: "ref",
				nullable: true,
				typeIndex: arrInfo.typeIndex,
			};
		}
		return { kind: "ref", nullable: true, heapType: "array" };
	}

	if (goType.kind === "struct") {
		if (goType.name && mod?.getStructType(goType.name)) {
			return {
				kind: "ref",
				nullable: true,
				typeIndex: mod.getStructType(goType.name).typeIndex,
			};
		}
		return { kind: "ref", nullable: true, heapType: "struct" };
	}

	if (isFuncType(goType, checker)) {
		if (mod) {
			const closureInfo = mod.getClosureType(goType);
			return {
				kind: "ref",
				nullable: true,
				typeIndex: closureInfo.typeIndex,
			};
		}
		return "funcref";
	}

	if (goType.kind === "interface" || goType.kind === "InterfaceType") {
		return "anyref";
	}

	return "i32";
}

export function isStructType(goType, checker = null, mod = null) {
	if (!goType) return false;
	if (goType.kind === "TypeName" || goType.kind === "Ident") {
		if (mod?.getStructType?.(goType.name)) return true;
		const resolved = checker?.types?.get(goType.name);
		if (resolved) return isStructType(resolved, checker, mod);
	}
	if (goType.kind === "named") {
		if (mod?.getStructType?.(goType.name)) return true;
		if (goType.underlying) return isStructType(goType.underlying, checker, mod);
	}
	return goType.kind === "struct" || goType.kind === "StructType";
}

export function isPointerToStruct(goType, checker = null, mod = null) {
	if (!goType) return false;
	if (goType.kind === "PointerType" || goType.kind === "pointer") {
		return isStructType(goType.base, checker, mod);
	}
	if (goType.kind === "StarExpr") {
		return isStructType(goType.expr ?? goType.operand, checker, mod);
	}
	return false;
}

export function isSliceType(goType, checker = null) {
	if (!goType) return false;
	if (goType.kind === "TypeName" || goType.kind === "Ident") {
		const resolved = checker?.types?.get(goType.name);
		if (resolved) return isSliceType(resolved, checker);
	}
	if (goType.kind === "named" && goType.underlying) {
		return isSliceType(goType.underlying, checker);
	}
	return goType.kind === "slice" || goType.kind === "SliceType";
}

export function isArrayType(goType, checker = null) {
	if (!goType) return false;
	if (goType.kind === "TypeName" || goType.kind === "Ident") {
		const resolved = checker?.types?.get(goType.name);
		if (resolved) return isArrayType(resolved, checker);
	}
	if (goType.kind === "named" && goType.underlying) {
		return isArrayType(goType.underlying, checker);
	}
	return goType.kind === "array" || goType.kind === "ArrayType";
}

export function isStringType(goType, checker = null) {
	if (!goType) return false;
	if (goType.kind === "TypeName" || goType.kind === "Ident") {
		const resolved = checker?.types?.get(goType.name);
		if (resolved) return isStringType(resolved, checker);
		return goType.name === "string";
	}
	if (goType.kind === "named") {
		if (goType.name === "string") return true;
		if (goType.underlying) return isStringType(goType.underlying, checker);
	}
	if (goType.kind === "basic") return goType.name === "string";
	if (goType.kind === "untyped") return goType.base === "string";
	return false;
}

export function isAnyType(goType, checker = null) {
	if (!goType) return false;
	if (goType.kind === "TypeName" || goType.kind === "Ident") {
		const resolved = checker?.types?.get(goType.name);
		if (resolved) return isAnyType(resolved, checker);
		return goType.name === "any" || goType.name === "interface{}";
	}
	if (goType.kind === "named") {
		if (goType.name === "any" || goType.name === "interface{}") return true;
		if (goType.underlying) return isAnyType(goType.underlying, checker);
	}
	if (goType.kind === "basic") return goType.name === "any";
	if (goType.kind === "interface") return true;
	return false;
}

export function isNarrowInt(goType) {
	if (!goType) return false;
	if (goType.kind === "TypeName" || goType.kind === "Ident") {
		return isNarrowInt({ kind: "basic", name: goType.name });
	}
	if (goType.kind === "named" && goType.underlying) {
		return isNarrowInt(goType.underlying);
	}
	if (goType.kind === "basic") {
		switch (goType.name) {
			case "int8":
			case "int16":
			case "uint8":
			case "uint16":
			case "byte":
				return true;
		}
	}
	return false;
}

export function isSigned(goType) {
	if (!goType) return true;
	if (goType.kind === "TypeName" || goType.kind === "Ident") {
		return isSigned({ kind: "basic", name: goType.name });
	}
	if (goType.kind === "named" && goType.underlying) {
		return isSigned(goType.underlying);
	}
	if (goType.kind === "basic") {
		return !goType.name.startsWith("uint") && goType.name !== "byte";
	}
	return true;
}

export function isFloat(goType) {
	if (!goType) return false;
	if (goType.kind === "TypeName" || goType.kind === "Ident") {
		return isFloat({ kind: "basic", name: goType.name });
	}
	if (goType.kind === "named" && goType.underlying) {
		return isFloat(goType.underlying);
	}
	if (goType.kind === "untyped") return goType.base === "float64";
	return (
		goType.kind === "basic" &&
		(goType.name === "float32" || goType.name === "float64")
	);
}

export function isInt(goType) {
	if (!goType) return false;
	if (goType.kind === "TypeName" || goType.kind === "Ident") {
		return isInt({ kind: "basic", name: goType.name });
	}
	if (goType.kind === "named" && goType.underlying) {
		return isInt(goType.underlying);
	}
	if (goType.kind === "untyped") return goType.base === "int";
	if (goType.kind === "basic") {
		return (
			goType.name.startsWith("int") ||
			goType.name.startsWith("uint") ||
			goType.name === "byte" ||
			goType.name === "rune" ||
			goType.name === "uintptr"
		);
	}
	return false;
}

export function isFuncType(goType, checker = null) {
	if (!goType) return false;
	if (goType.kind === "TypeName" || goType.kind === "Ident") {
		const resolved = checker?.types?.get(goType.name);
		if (resolved) return isFuncType(resolved, checker);
	}
	if (goType.kind === "named" && goType.underlying) {
		return isFuncType(goType.underlying, checker);
	}
	return (
		goType.kind === "func" ||
		goType.kind === "FuncType" ||
		goType.kind === "FuncLit" ||
		goType.kind === "FuncDecl"
	);
}

export function getFuncSignature(goType, checker = null) {
	if (!goType) return { params: [], returns: [] };
	if (goType.kind === "TypeName" || goType.kind === "Ident") {
		const resolved = checker?.types?.get(goType.name);
		if (resolved) return getFuncSignature(resolved, checker);
	}
	if (goType.kind === "named" && goType.underlying) {
		return getFuncSignature(goType.underlying, checker);
	}
	if (
		goType.kind === "FuncType" ||
		goType.kind === "FuncLit" ||
		goType.kind === "FuncDecl"
	) {
		const params = (goType.params ?? []).map((p) => p.type ?? p);
		const returns = [];
		if (goType.returnType) {
			if (
				goType.returnType.kind === "TupleType" ||
				goType.returnType.kind === "tuple"
			) {
				returns.push(...(goType.returnType.types ?? []));
			} else {
				returns.push(goType.returnType);
			}
		} else if (goType.returns) {
			for (const r of goType.returns) {
				if ((r?.kind === "tuple" || r?.kind === "TupleType") && r.types) {
					returns.push(...r.types);
				} else {
					returns.push(r);
				}
			}
		}
		return { params, returns };
	}
	if (goType.kind === "func") {
		const rawReturns =
			goType.returns ?? (goType.returnType ? [goType.returnType] : []);
		const returns = [];
		for (const r of rawReturns) {
			if ((r?.kind === "tuple" || r?.kind === "TupleType") && r.types) {
				returns.push(...r.types);
			} else {
				returns.push(r);
			}
		}
		return { params: goType.params ?? [], returns };
	}
	return { params: [], returns: [] };
}
