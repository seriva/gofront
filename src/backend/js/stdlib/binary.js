// src/backend/js/stdlib/binary.js
// CodeGen for Go encoding/binary package.

function sizeOfGoType(gt) {
	if (!gt) return -1;
	if (gt.kind === "basic") {
		switch (gt.name) {
			case "bool":
			case "int8":
			case "uint8":
			case "byte":
				return 1;
			case "int16":
			case "uint16":
				return 2;
			case "int32":
			case "uint32":
			case "float32":
			case "rune":
				return 4;
			case "int64":
			case "uint64":
			case "float64":
			case "int":
			case "uint":
			case "uintptr":
				return 8;
			default:
				return -1;
		}
	}
	if (gt.kind === "array" || gt.kind === "ArrayType") {
		const es = sizeOfGoType(gt.elem);
		const len = gt.len ?? gt.size ?? 0;
		return es > 0 ? es * len : -1;
	}
	if (
		gt.kind === "pointer" ||
		gt.kind === "PointerType" ||
		gt.kind === "StarExpr"
	) {
		return sizeOfGoType(gt.base ?? gt.expr ?? gt.operand);
	}
	if (gt.kind === "struct" || gt.kind === "StructType") {
		let total = 0;
		if (gt.fields instanceof Map) {
			for (const fType of gt.fields.values()) {
				const s = sizeOfGoType(fType);
				if (s < 0) return -1;
				total += s;
			}
			return total;
		}
	}
	return -1;
}

export const binaryMethods = {
	_genBinary(fn, a, expr) {
		this.useHelper("binary");
		this.useHelper("error");
		const args = a();
		if (fn === "Read") {
			const targetType = expr?.args?.[2]?._type;
			const baseType = targetType?.base ?? targetType;
			const sz = sizeOfGoType(baseType);
			return `__binary_read(${args[0]}, ${args[1]}, ${args[2]}${sz > 0 ? `, ${sz}` : ""})`;
		}
		if (fn === "Write") {
			const sz = sizeOfGoType(expr?.args?.[2]?._type);
			return `__binary_write(${args[0]}, ${args[1]}, ${args[2]}${sz > 0 ? `, ${sz}` : ""})`;
		}
		if (fn === "Size") {
			const sz = sizeOfGoType(expr?.args?.[0]?._type);
			if (sz >= 0) return `${sz}`;
			return `__binary_size(${args[0]})`;
		}
		if (fn === "AppendUint16")
			return `__binary_le.AppendUint16(${args[0]}, ${args[1]})`;
		if (fn === "AppendUint32")
			return `__binary_le.AppendUint32(${args[0]}, ${args[1]})`;
		if (fn === "AppendUint64")
			return `__binary_le.AppendUint64(${args[0]}, ${args[1]})`;
		return undefined;
	},
};
