// CodeGen for Go `maps` package.

/** @typedef {import('../index.js').CodeGen} CodeGen */

/** @type {ThisType<CodeGen>} */
export const mapsMethods = {
	_genMaps(fn, a) {
		if (fn === "Equal") {
			this._usesEqual = true;
			const [a1, b1] = a();
			return `__equal(${a1}, ${b1})`;
		}
		switch (fn) {
			case "Keys": {
				const [m] = a();
				return `Object.keys(${m})`;
			}
			case "Values": {
				const [m] = a();
				return `Object.values(${m})`;
			}
			case "Clone": {
				const [m] = a();
				return `({...${m}})`;
			}
			case "Copy": {
				const [dst, src] = a();
				return `Object.assign(${dst}, ${src})`;
			}
			case "EqualFunc": {
				const [m1, m2, eq] = a();
				return `((a, b, f) => { const ka = Object.keys(a); if (ka.length !== Object.keys(b).length) return false; return ka.every(k => k in b && f(a[k], b[k])); })(${m1}, ${m2}, ${eq})`;
			}
			case "Delete": {
				const [m, k] = a();
				return `(delete ${m}[${k}], undefined)`;
			}
			case "DeleteFunc": {
				const [m, fn2] = a();
				return `Object.keys(${m}).forEach(k => { if (${fn2}(k, ${m}[k])) delete ${m}[k]; })`;
			}
		}
		return undefined;
	},
};
