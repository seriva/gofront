// src/backend/wasm/types.js
// Maps GoFront types to WasmGC types and manages type registry.

export function toWasmType(goType, checker = null) {
	if (!goType) return "i32";

	// TypeName AST node
	if (goType.kind === "TypeName") {
		return toWasmType({ kind: "basic", name: goType.name }, checker);
	}
	if (goType.kind === "Ident") {
		return toWasmType({ kind: "basic", name: goType.name }, checker);
	}

	// Unwrap named types
	if (goType.kind === "named" && goType.underlying) {
		return toWasmType(goType.underlying, checker);
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
		return { kind: "ref", nullable: true, heapType: "any" };
	}

	if (goType.kind === "slice") {
		return { kind: "ref", nullable: true, heapType: "struct" };
	}

	if (goType.kind === "array") {
		return { kind: "ref", nullable: true, heapType: "array" };
	}

	if (goType.kind === "struct") {
		return { kind: "ref", nullable: true, heapType: "struct" };
	}

	if (goType.kind === "func") {
		return "funcref";
	}

	if (goType.kind === "interface") {
		return "anyref";
	}

	return "i32";
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
