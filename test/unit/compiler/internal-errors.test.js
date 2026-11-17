// GoFront test suite — internal compiler errors and the WebAssembly validity gate

import {
	asInternalError,
	CompileError,
	InternalCompilerError,
	validateWasm,
} from "../../../src/compiler.js";
import { ParseError } from "../../../src/parser/index.js";
import {
	TypeCheckError,
	UnsupportedError,
} from "../../../src/typechecker/types.js";
import {
	assert,
	assertContains,
	assertEqual,
	assertThrows,
	section,
	summarize,
	test,
} from "../helpers.js";

const HEADER = [0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00];
const TYPE_FUNC_RETURNING_I32 = [0x01, 0x05, 0x01, 0x60, 0x00, 0x01, 0x7f];
const ONE_FUNC = [0x03, 0x02, 0x01, 0x00];

// One function `() -> i32` whose body is `body` (locals 0, then `end`).
function moduleWithBody(body) {
	const code = [0x00, ...body, 0x0b];
	return new Uint8Array([
		...HEADER,
		...TYPE_FUNC_RETURNING_I32,
		...ONE_FUNC,
		0x0a,
		code.length + 2,
		0x01,
		code.length,
		...code,
	]);
}

const VALID = moduleWithBody([0x41, 0x00]); // i32.const 0
const INVALID = moduleWithBody([0x6a]); // i32.add on an empty stack

section("validateWasm");

test("the hand-encoded valid module validates", () => {
	assert(WebAssembly.validate(VALID), "fixture must be valid");
	validateWasm(VALID);
});

test("a module whose body adds on an empty stack is an internal error", () => {
	assert(!WebAssembly.validate(INVALID), "fixture must be invalid");
	let err = null;
	try {
		validateWasm(INVALID);
	} catch (e) {
		err = e;
	}
	assert(err instanceof InternalCompilerError, "InternalCompilerError");
	assert(err.message.startsWith("internal compiler error: "), "message prefix");
	assertContains(err.message, "invalid");
	assertContains(err.message, "https://github.com/seriva/gofront/issues");
});

section("asInternalError");

test("an ordinary error becomes an internal compiler error", () => {
	const boom = new Error("boom");
	let err = null;
	try {
		asInternalError(() => {
			throw boom;
		});
	} catch (e) {
		err = e;
	}
	assert(err instanceof InternalCompilerError, "InternalCompilerError");
	assert(
		err.message.startsWith("internal compiler error: boom"),
		`message: ${err.message}`,
	);
	assertContains(err.message, "https://github.com/seriva/gofront/issues");
	assert(err.cause === boom, "cause is the original error");
});

test("a CompileError passes through unchanged", () => {
	const original = new CompileError([new Error("bad program")]);
	let err = null;
	try {
		asInternalError(() => {
			throw original;
		});
	} catch (e) {
		err = e;
	}
	assert(err === original, "same object");
});

test("an InternalCompilerError is not wrapped twice", () => {
	const original = new InternalCompilerError(new Error("inner"));
	let err = null;
	try {
		asInternalError(() => {
			throw original;
		});
	} catch (e) {
		err = e;
	}
	assert(err === original, "same object");
});

test("UnsupportedError, TypeCheckError and ParseError come out as CompileError", () => {
	for (const thrown of [
		new UnsupportedError("not supported yet"),
		new TypeCheckError("bad", null, "main.go", null),
		new ParseError("bad token", { line: 1, col: 1, type: "EOF", value: "" }),
	]) {
		let err = null;
		try {
			asInternalError(() => {
				throw thrown;
			});
		} catch (e) {
			err = e;
		}
		assert(err instanceof CompileError, `${thrown.name} -> CompileError`);
		assert(!(err instanceof InternalCompilerError), "not an internal error");
		assertEqual(err.errors.length, 1);
		assert(err.errors[0] === thrown, "keeps the original entry");
		assertEqual(err.message, thrown.message);
	}
});

test("the result of the thunk is returned", () => {
	assertEqual(
		asInternalError(() => 42),
		42,
	);
	assertThrows(
		() =>
			asInternalError(() => {
				throw new Error("x");
			}),
		"internal compiler error: x",
	);
});

summarize();
