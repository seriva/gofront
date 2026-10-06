// src/backend/wasm/glue.js
// Runtime imports and JS glue for executing GoFront WASM modules.

import { WASM_IMPORTS_JS } from "./boundary.js";

// The import table is authored once as source text (it is spliced into the
// production bundle by the facade); evaluate that same text here so tests
// exercise exactly what ships.  The text is a compile-time constant.
const makeImports = new Function(`${WASM_IMPORTS_JS}\nreturn __gfw_imports;`)();

export function createWasmImports({
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
						if (tag && e instanceof WebAssembly.Exception && e.is(tag)) {
							const msg = e.getArg(tag, 0);
							throw new Error(String(msg));
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
											throw new Error(String(msg));
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
