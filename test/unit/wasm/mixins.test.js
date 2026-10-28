// GoFront test suite — WASM stdlib emitter registry

import {
	copyMethods,
	FunctionEmitter,
} from "../../../src/backend/wasm/emit.js";
import { stdlibEmitters } from "../../../src/backend/wasm/stdlib/index.js";
import {
	assert,
	assertEqual,
	assertThrows,
	section,
	test,
} from "../helpers.js";

section("WASM stdlib mixins — registry");

function ownMethods(cls) {
	return Object.getOwnPropertyNames(cls.prototype).filter(
		(k) => k !== "constructor",
	);
}

test("stdlibEmitters is a non-empty list of distinct classes", () => {
	assert(stdlibEmitters.length > 0, "registry is empty");
	assertEqual(new Set(stdlibEmitters).size, stdlibEmitters.length);
});

test("every registered emitter is mixed into FunctionEmitter", () => {
	for (const cls of stdlibEmitters) {
		const methods = ownMethods(cls);
		assert(methods.length > 0, `${cls.name} has no methods`);
		for (const m of methods) {
			assert(
				m in FunctionEmitter.prototype,
				`${cls.name}.${m} is missing from FunctionEmitter.prototype`,
			);
			assertEqual(
				Object.getOwnPropertyDescriptor(FunctionEmitter.prototype, m).value,
				Object.getOwnPropertyDescriptor(cls.prototype, m).value,
			);
		}
	}
});

test("copyMethods throws on a duplicate method name", () => {
	class Target {
		alpha() {}
	}
	class Source {
		alpha() {}
	}
	assertThrows(
		() => copyMethods(Target, Source),
		'Duplicate method "alpha" found while mixing Source into Target',
	);
});

test("copyMethods copies new methods and skips the constructor", () => {
	class Target {
		alpha() {}
	}
	class Source {
		beta() {
			return 7;
		}
	}
	copyMethods(Target, Source);
	assertEqual(new Target().beta(), 7);
	assert(Target.prototype.constructor === Target, "constructor replaced");
});
