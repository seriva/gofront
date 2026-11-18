// Backend lookups of a checker `named` type's underlying type: a bare
// `{ kind: "named", name }` stub resolves through the checker's type table,
// and a named cycle terminates instead of overflowing the stack.

import { FunctionEmitter } from "../../../src/backend/wasm/emit.js";
import { BuiltinsEmitter } from "../../../src/backend/wasm/emit-builtins.js";
import {
	getMapKeyValTypes,
	getSliceElemType,
	isArrayType,
	isMapType,
	isSliceType,
	isStringType,
	isTaggedSliceType,
} from "../../../src/backend/wasm/types.js";
import { assert, assertEqual, section, test } from "../helpers.js";

section("WASM named underlying lookups");

const intT = { kind: "basic", name: "int" };

function cycleChecker() {
	const a = { kind: "named", name: "A", underlying: null };
	const b = { kind: "named", name: "B", underlying: null };
	a.underlying = b;
	b.underlying = a;
	return {
		types: new Map([
			["A", a],
			["B", b],
		]),
	};
}

function chainChecker() {
	return {
		types: new Map([
			[
				"S",
				{ kind: "named", name: "S", underlying: { kind: "slice", elem: intT } },
			],
			[
				"M",
				{
					kind: "named",
					name: "M",
					underlying: { kind: "map", key: intT, value: intT },
				},
			],
			[
				"Arr",
				{
					kind: "named",
					name: "Arr",
					underlying: { kind: "array", elem: intT, size: 3 },
				},
			],
			[
				"Str",
				{
					kind: "named",
					name: "Str",
					underlying: { kind: "basic", name: "string" },
				},
			],
		]),
	};
}

test("a two-type named cycle does not overflow the stack", () => {
	const c = cycleChecker();
	const stub = { kind: "named", name: "A" };
	assert(!isSliceType(stub, c), "isSliceType");
	assert(!isMapType(stub, c), "isMapType");
	assert(!isStringType(stub, c), "isStringType");
	assert(!isArrayType(stub, c), "isArrayType");
	assert(!isTaggedSliceType(stub, c), "isTaggedSliceType");
	assertEqual(getMapKeyValTypes(stub, c).keyType, null);
	assertEqual(getSliceElemType(stub, c), null);
	assert(!isSliceType(c.types.get("A"), c), "resolved cycle member");
});

test("a bare named stub resolves slice, map, array and string", () => {
	const c = chainChecker();
	const stub = (name) => ({ kind: "named", name });
	assert(isSliceType(stub("S"), c));
	assertEqual(getSliceElemType(stub("S"), c), intT);
	assert(isTaggedSliceType(stub("S"), c));
	assert(isMapType(stub("M"), c));
	assertEqual(getMapKeyValTypes(stub("M"), c).valType, intT);
	assert(isArrayType(stub("Arr"), c));
	assert(isStringType(stub("Str"), c));
});

function emitterStub(checker) {
	return {
		mod: { checker },
		_getSliceElemType: BuiltinsEmitter.prototype._getSliceElemType,
		_getArrayElemType: FunctionEmitter.prototype._getArrayElemType,
		_getArraySize: FunctionEmitter.prototype._getArraySize,
	};
}

test("emitter element and size lookups resolve a bare named stub", () => {
	const e = emitterStub(chainChecker());
	const stub = (name) => ({ kind: "named", name });
	assertEqual(e._getSliceElemType(stub("S")), intT);
	assertEqual(e._getArrayElemType(stub("Arr")), intT);
	assertEqual(e._getArraySize(stub("Arr"), 0), 3);
	const cyc = emitterStub(cycleChecker());
	assertEqual(cyc._getSliceElemType(stub("A")), null);
	assertEqual(cyc._getArraySize(stub("A"), 7), 7);
});
