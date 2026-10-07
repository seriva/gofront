// src/backend/wasm/wat.js
// Emits WebAssembly Text (WAT) format from Module IR.

function formatValType(t) {
	if (typeof t === "string") return t;
	if (typeof t === "number") return `(type ${t})`;
	if (typeof t === "object" && t !== null) {
		if (t.kind === "ref") {
			const nullStr = t.nullable ? "null " : "";
			const target =
				t.typeIndex !== undefined ? `$t${t.typeIndex}` : (t.heapType ?? "any");
			return `(ref ${nullStr}${target})`;
		}
	}
	return String(t);
}

function formatTypeEntry(t, id) {
	const typeId = id !== undefined ? ` $t${id}` : "";
	if (t.form === "rec") {
		const inners = t.types
			.map(
				(sub, i) =>
					`    ${formatTypeEntry(sub, typeof id === "number" ? id + i : `${id}_${i}`)}`,
			)
			.join("\n");
		return `(rec\n${inners}\n  )`;
	}
	if (t.form === "struct") {
		const fields = (t.fields ?? [])
			.map((f) => {
				const inner = formatValType(f.type);
				return f.mutable ? `(field (mut ${inner}))` : `(field ${inner})`;
			})
			.join(" ");
		return `(type${typeId} (struct ${fields}))`;
	}
	if (t.form === "array") {
		const inner = formatValType(t.elemType ?? t.type);
		const field = t.mutable ? `(mut ${inner})` : inner;
		return `(type${typeId} (array ${field}))`;
	}
	// func
	const params = (t.params ?? []).map(formatValType).join(" ");
	const results = (t.results ?? []).map(formatValType).join(" ");
	const paramStr = params ? ` (param ${params})` : "";
	const resultStr = results ? ` (result ${results})` : "";
	return `(type${typeId} (func${paramStr}${resultStr}))`;
}

function formatInstruction(inst) {
	if (typeof inst === "string") return inst;
	const { op } = inst;
	switch (op) {
		case "block":
		case "loop":
		case "if": {
			const bt = inst.blockType ?? inst.resultType;
			const res = bt && bt !== "void" ? ` (result ${formatValType(bt)})` : "";
			return `${op}${res}`;
		}
		case "br":
		case "br_if":
			return `${op} ${inst.depth ?? inst.index ?? 0}`;
		case "br_table": {
			const targets = (inst.targets ?? []).join(" ");
			return `${op} ${targets} ${inst.defaultTarget ?? 0}`;
		}
		case "call":
		case "return_call":
			return `${op} ${inst.funcIndex ?? inst.index ?? 0}`;
		case "call_indirect":
			return `${op} (type $t${inst.typeIndex ?? 0})`;
		case "call_ref":
		case "return_call_ref":
			return `${op} (type $t${inst.typeIndex ?? 0})`;
		case "ref.func":
			return `ref.func ${inst.funcIndex ?? inst.index ?? 0}`;
		case "local.get":
		case "local.set":
		case "local.tee":
			return `${op} ${inst.localIndex ?? inst.index ?? 0}`;
		case "global.get":
		case "global.set":
			return `${op} ${inst.globalIndex ?? inst.index ?? 0}`;
		case "i32.const":
		case "i64.const":
			return `${op} ${inst.value ?? 0}`;
		case "f32.const":
		case "f64.const": {
			const v = inst.value ?? 0;
			if (Number.isNaN(v)) return `${op} nan`;
			if (v === Infinity) return `${op} inf`;
			if (v === -Infinity) return `${op} -inf`;
			return `${op} ${v}`;
		}
		case "throw":
			return `${op} ${inst.tagIndex ?? inst.index ?? 0}`;
		case "throw_ref":
			return "throw_ref";
		case "try_table": {
			const bt = inst.blockType ?? inst.resultType;
			const res = bt && bt !== "void" ? ` (result ${formatValType(bt)})` : "";
			const catches = (inst.catches ?? [])
				.map((c) => {
					const k = c.kind ?? c.op;
					if (k === "catch")
						return `(catch ${c.tagIndex ?? 0} ${c.label ?? 0})`;
					if (k === "catch_ref")
						return `(catch_ref ${c.tagIndex ?? 0} ${c.label ?? 0})`;
					if (k === "catch_all") return `(catch_all ${c.label ?? 0})`;
					if (k === "catch_all_ref") return `(catch_all_ref ${c.label ?? 0})`;
					return "";
				})
				.filter(Boolean)
				.join(" ");
			return `${op}${res}${catches ? ` ${catches}` : ""}`;
		}
		case "struct.new":
			return `struct.new ${inst.typeIndex !== undefined ? `$t${inst.typeIndex}` : 0}`;
		case "struct.get":
		case "struct.get_s":
		case "struct.get_u":
		case "struct.set":
			return `${op} ${inst.typeIndex !== undefined ? `$t${inst.typeIndex}` : 0} ${inst.fieldIndex ?? 0}`;
		case "array.new":
		case "array.new_default":
		case "array.get":
		case "array.get_s":
		case "array.get_u":
		case "array.set":
			return `${op} ${inst.typeIndex !== undefined ? `$t${inst.typeIndex}` : 0}`;
		case "array.new_fixed":
			return `${op} ${inst.typeIndex !== undefined ? `$t${inst.typeIndex}` : 0} ${inst.size ?? inst.count ?? 0}`;
		case "array.copy":
			return `${op} ${inst.typeIndexDst !== undefined ? `$t${inst.typeIndexDst}` : `$t${inst.typeIndex ?? 0}`} ${inst.typeIndexSrc !== undefined ? `$t${inst.typeIndexSrc}` : `$t${inst.typeIndex ?? 0}`}`;
		case "array.len":
			return "array.len";
		case "ref.test":
		case "ref.test_null":
		case "ref.cast":
		case "ref.cast_null":
			return `${op} ${inst.typeIndex !== undefined ? `$t${inst.typeIndex}` : 0}`;
		case "any.convert_extern":
		case "extern.convert_any":
			return op;
		default:
			return op;
	}
}

export function emitWat(mod) {
	const lines = ["(module"];

	// 1. Types
	if (mod.types && mod.types.length > 0) {
		let typeIdx = 0;
		for (let i = 0; i < mod.types.length; i++) {
			const entry = mod.types[i];
			lines.push(`  ${formatTypeEntry(entry, typeIdx)}`);
			if (entry.form === "rec") {
				typeIdx += entry.types.length;
			} else {
				typeIdx += 1;
			}
		}
	}

	// 2. Imports
	if (mod.imports && mod.imports.length > 0) {
		for (const imp of mod.imports) {
			const desc =
				imp.kind === "func"
					? `(func (type $t${imp.typeIndex ?? 0}))`
					: imp.kind === "tag"
						? `(tag (type $t${imp.typeIndex ?? 0}))`
						: `(${imp.kind})`;
			lines.push(`  (import "${imp.module}" "${imp.name}" ${desc})`);
		}
	}

	// 3. Tags
	if (mod.tags && mod.tags.length > 0) {
		for (let i = 0; i < mod.tags.length; i++) {
			lines.push(`  (tag $tag${i} (type $t${mod.tags[i].typeIndex ?? 0}))`);
		}
	}

	// 4. Globals
	if (mod.globals && mod.globals.length > 0) {
		for (let i = 0; i < mod.globals.length; i++) {
			const g = mod.globals[i];
			const t = formatValType(g.type);
			const typeStr = g.mutable ? `(mut ${t})` : t;
			const initStr = (g.init ?? [{ op: "i32.const", value: 0 }])
				.map(formatInstruction)
				.join(" ");
			lines.push(`  (global $g${i} ${typeStr} ${initStr})`);
		}
	}

	// 5. Elements (declarative for ref.func)
	if (mod.elements && mod.elements.length > 0) {
		lines.push(
			`  (elem declare func ${mod.elements.map((idx) => `$f${idx}`).join(" ")})`,
		);
	}

	// Map exports by kind & index
	const exportsByFunc = new Map();
	for (const exp of mod.exports ?? []) {
		if (exp.kind === "func") {
			if (!exportsByFunc.has(exp.index)) exportsByFunc.set(exp.index, []);
			exportsByFunc.get(exp.index).push(exp.name);
		}
	}

	// 5. Functions
	if (mod.funcs && mod.funcs.length > 0) {
		const importFuncCount = (mod.imports ?? []).filter(
			(i) => i.kind === "func",
		).length;
		// Type indices count every member of a rec group, not the group entry.
		const flatTypes = (mod.types ?? []).flatMap((t) =>
			t.form === "rec" ? t.types : [t],
		);

		for (let i = 0; i < mod.funcs.length; i++) {
			const fn = mod.funcs[i];
			const globalFuncIdx = importFuncCount + i;
			const expNames = exportsByFunc.get(globalFuncIdx) ?? [];
			const expStr = expNames.map((n) => ` (export "${n}")`).join("");

			const typeEntry = flatTypes[fn.typeIndex] ?? null;
			let sigStr = ` (type $t${fn.typeIndex ?? 0})`;
			if (typeEntry && typeEntry.form === "func") {
				const params = (typeEntry.params ?? []).map(formatValType).join(" ");
				const results = (typeEntry.results ?? []).map(formatValType).join(" ");
				if (params) sigStr += ` (param ${params})`;
				if (results) sigStr += ` (result ${results})`;
			}

			lines.push(`  (func $f${globalFuncIdx}${expStr}${sigStr}`);

			// Locals
			if (fn.locals && fn.locals.length > 0) {
				const locTypes = fn.locals.map((l) =>
					l && typeof l === "object" && "type" in l && !l.kind ? l.type : l,
				);
				lines.push(`    (local ${locTypes.map(formatValType).join(" ")})`);
			}

			// Body instructions
			for (const inst of fn.body ?? []) {
				lines.push(`    ${formatInstruction(inst)}`);
			}
			lines.push("  )");
		}
	}

	// 6. Remaining exports (e.g. tags, globals, memories)
	for (const exp of mod.exports ?? []) {
		if (exp.kind !== "func") {
			lines.push(`  (export "${exp.name}" (${exp.kind} ${exp.index}))`);
		}
	}

	// 7. Start function
	if (typeof mod.start === "number") {
		lines.push(`  (start $f${mod.start})`);
	}

	lines.push(")");
	return `${lines.join("\n")}\n`;
}
