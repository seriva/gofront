// src/backend/wasm/glue.js
// Runtime imports and JS glue for executing GoFront WASM modules.

export function createWasmImports({
	stringTable = [],
	panicTag = null,
	stdout = null,
	extra = {},
} = {}) {
	const tag = panicTag ?? new WebAssembly.Tag({ parameters: ["externref"] });

	let lineBuf = [];
	const flushLine = () => {
		const str = lineBuf.join(" ");
		lineBuf = [];
		if (stdout) {
			stdout(str);
		} else {
			console.log(str);
		}
	};

	const env = {
		panicTag: tag,
		str: (idx) => stringTable[idx] ?? "",
		print_i32: (v) => lineBuf.push(String(v)),
		print_i64: (v) => lineBuf.push(String(v)),
		print_f32: (v) => lineBuf.push(String(v)),
		print_f64: (v) => lineBuf.push(String(v)),
		print_str: (s) => lineBuf.push(String(s)),
		print_bool: (b) => lineBuf.push(b !== 0 ? "true" : "false"),
		println_i32: (v) => {
			lineBuf.push(String(v));
			flushLine();
		},
		println_i64: (v) => {
			lineBuf.push(String(v));
			flushLine();
		},
		println_f32: (v) => {
			lineBuf.push(String(v));
			flushLine();
		},
		println_f64: (v) => {
			lineBuf.push(String(v));
			flushLine();
		},
		println_str: (s) => {
			lineBuf.push(String(s));
			flushLine();
		},
		println_bool: (b) => {
			lineBuf.push(b !== 0 ? "true" : "false");
			flushLine();
		},
		println_empty: () => flushLine(),
		...extra.env,
	};

	const mathImports = {
		sin: Math.sin,
		cos: Math.cos,
		tan: Math.tan,
		asin: Math.asin,
		acos: Math.acos,
		atan: Math.atan,
		atan2: Math.atan2,
		pow: Math.pow,
		exp: Math.exp,
		log: Math.log,
		log2: Math.log2,
		log10: Math.log10,
		round: Math.round,
		...extra.Math,
	};

	return {
		imports: {
			env,
			Math: mathImports,
			...extra,
		},
		panicTag: tag,
	};
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
