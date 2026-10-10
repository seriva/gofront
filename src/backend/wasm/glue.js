// src/backend/wasm/glue.js
// Runtime imports and JS glue for executing GoFront WASM modules.

import { WASM_IMPORTS_JS, WASM_STDLIB_JS } from "./boundary.js";

// The import table is authored once as source text (it is spliced into the
// production bundle by the facade); evaluate that same text here so tests
// exercise exactly what ships.  The text is a compile-time constant.
const makeImports = new Function(
	`${WASM_IMPORTS_JS}\n${WASM_STDLIB_JS}\nreturn __gfw_imports;`,
)();

function createWasmImports({
	stringTable = [],
	panicTag = null,
	stdout = null,
	extra = {},
} = {}) {
	const tag = panicTag ?? new WebAssembly.Tag({ parameters: ["externref"] });
	const write = stdout ?? ((s) => console.log(s));
	const { env: _ignored, Math: extraMath, ...extraModules } = extra;
	const imports = makeImports(stringTable, extra.env ?? {}, tag, write);
	Object.assign(imports.Math, extraMath);
	Object.assign(imports, extraModules);
	return { imports, panicTag: tag };
}

const NIL_DEREF_PATTERNS = [
	"dereferencing a null pointer", // V8
	"dereferencing null pointer", // SpiderMonkey
	"null pointer dereference", // SpiderMonkey
	"null dereference", // JavaScriptCore
];

function safeString(v) {
	try {
		return String(v);
	} catch {
		return "[panic object]";
	}
}

function isNilDerefTrap(e) {
	if (
		typeof WebAssembly !== "undefined" &&
		e instanceof WebAssembly.RuntimeError
	) {
		const msg = e.message || "";
		return NIL_DEREF_PATTERNS.some((p) => msg.includes(p));
	}
	return false;
}

export function instantiateWasm(
	wasmBytes,
	{ stringTable = [], stdout = null, extraImports = {} } = {},
) {
	const { imports, panicTag: defaultPanicTag } = createWasmImports({
		stringTable,
		stdout,
		extra: extraImports,
	});

	const module = new WebAssembly.Module(wasmBytes);
	const instance = new WebAssembly.Instance(module, imports);
	imports.__bind?.(instance.exports);

	// The module exports its panic tag if defined internally, or uses the imported one
	const tag = instance.exports.panicTag ?? defaultPanicTag;

	// Wrap exports to convert WASM panic exceptions into standard JS Errors
	const wrappedExports = {};
	for (const [name, val] of Object.entries(instance.exports)) {
		if (typeof val === "function") {
			wrappedExports[name] = (...args) => {
				let cur = [...args];
				for (let attempt = 0; attempt <= cur.length; attempt++) {
					try {
						return val(...cur);
					} catch (e) {
						if (instance.exports.__panic) {
							instance.exports.__panic.value = null;
						}
						if (tag && e instanceof WebAssembly.Exception && e.is(tag)) {
							const msg = e.getArg(tag, 0);
							throw new Error(safeString(msg));
						}
						if (isNilDerefTrap(e)) {
							throw new Error(
								"runtime error: invalid memory address or nil pointer dereference",
							);
						}
						if (e instanceof TypeError && e.message.includes("to a BigInt")) {
							let coercedAny = false;
							for (let j = 0; j < cur.length; j++) {
								if (typeof cur[j] === "number" && Number.isInteger(cur[j])) {
									const testArgs = [...cur];
									testArgs[j] = BigInt(testArgs[j]);
									try {
										return val(...testArgs);
									} catch (inner) {
										if (
											tag &&
											inner instanceof WebAssembly.Exception &&
											inner.is(tag)
										) {
											const msg = inner.getArg(tag, 0);
											throw new Error(safeString(msg));
										}
										if (isNilDerefTrap(inner)) {
											throw new Error(
												"runtime error: invalid memory address or nil pointer dereference",
											);
										}
										if (
											inner instanceof TypeError &&
											inner.message.includes("to a BigInt")
										) {
											cur = testArgs;
											coercedAny = true;
											break;
										}
									}
								}
							}
							if (!coercedAny) throw e;
						} else {
							throw e;
						}
					}
				}
			};
		} else {
			wrappedExports[name] = val;
		}
	}

	return {
		instance,
		module,
		exports: wrappedExports,
		rawExports: instance.exports,
	};
}
