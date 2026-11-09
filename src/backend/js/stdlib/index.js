// CodeGen stdlib call generation — installed as a mixin on CodeGen.prototype.
// Dispatches `gofront/shared` and `gofront/simd` calls to inline JS.

import { SHARED_KINDS } from "../../../typechecker/stdlib/shared.js";

/** @typedef {import('../index.js').CodeGen} CodeGen */

// Stdlib namespace → handler method name. Used by _genStdlibCall to dispatch
// dynamically without creating static call edges.
const STDLIB_METHOD_MAP = {
	shared: "_genShared",
	simd: "_genSimd",
};

const dispatchMethods = {
	// `gofront/shared`: in js packages a shared buffer is just a TypedArray (no
	// linear memory is involved); in wasm packages the facade hands out
	// zero-copy views onto the module memory.
	_genShared(fn, a) {
		if (!fn.startsWith("New")) return undefined;
		const info = SHARED_KINDS[fn.slice(3)];
		if (!info) return undefined;
		return `new ${info.ctor}(${a()[0]})`;
	},

	// `gofront/simd` in JS packages.
	_genSimd(fn, a) {
		this.useHelper("simd");
		const args = a();
		switch (fn) {
			case "Splat":
				return `__simd_splat(${args[0]})`;
			case "NewF32x4":
				return `__simd_f32x4(${args[0]}, ${args[1]}, ${args[2]}, ${args[3]})`;
			case "Select":
				return `__simd_select(${args[0]}, ${args[1]}, ${args[2]})`;
			case "Shuffle":
				return `__simd_shuffle(${args.join(", ")})`;
			case "LoadF32x4":
				return `__simd_load(${args[0]}, ${args[1]})`;
			case "StoreF32x4":
				return `__simd_store(${args[0]}, ${args[1]}, ${args[2]})`;
			case "LoadF32x4Slice":
				return `__simd_load_slice(${args[0]}, ${args[1]})`;
			case "StoreF32x4Slice":
				return `__simd_store_slice(${args[0]}, ${args[1]}, ${args[2]})`;
			case "Pad4":
				return `(Math.floor((${args[0]} + 3) / 4) * 4)`;
			default:
				return undefined;
		}
	},

	typeComment(typeNode) {
		if (!typeNode) return "unknown";
		switch (typeNode.kind) {
			case "TypeName":
				return typeNode.name;
			case "SliceType":
				return `[]${this.typeComment(typeNode.elem)}`;
			case "MapType":
				return `map[${this.typeComment(typeNode.key)}]${this.typeComment(typeNode.value)}`;
			default:
				return typeNode.kind;
		}
	},

	// Dispatch table for stdlib namespace calls (pkg.Func → inline JS).
	// Returns the generated JS string, or undefined if not handled.
	_genStdlibCall(ns, fn, expr) {
		const method = STDLIB_METHOD_MAP[ns];
		if (!method) return undefined;
		// A member written in Go is an ordinary call of its mangled name.
		if (expr.func?._stdName) return undefined;
		// Stdlib shims take raw values, not the interface box of a named value.
		const isNamespace = expr.func?.expr?._type?.kind === "namespace";
		if (isNamespace) {
			for (const e of expr.args) if (e) e._noNamedBox = true;
		}
		const a = () => expr.args.map((e) => this.genExpr(e));
		const res = this[method](fn, a, expr);
		if (res === undefined && isNamespace) {
			for (const e of expr.args) if (e) delete e._noNamedBox;
		}
		return res;
	},
};

/** @type {ThisType<CodeGen>} */
export const stdlibGenMethods = {
	...dispatchMethods,
};
