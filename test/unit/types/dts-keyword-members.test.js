// GoFront test suite — `.d.ts` members named like keywords
//
// `type`, `class`, `static` and the like are valid member names (`Event.type`,
// `Element.class`); only a keyword that starts a declaration is one.

import { fileURLToPath } from "node:url";
import {
	assert,
	assertEqual,
	compileDts,
	parseDts,
	section,
	summarize,
	test,
} from "../helpers.js";

section(".d.ts — members named like keywords");

const NAMES = [
	"type",
	"class",
	"namespace",
	"module",
	"function",
	"readonly",
	"static",
	"enum",
	"declare",
	"interface",
	"const",
	"export",
	"abstract",
	"public",
];

test("a keyword-named property keeps its neighbours and its type", () => {
	for (const name of NAMES) {
		const { types } = parseDts(
			`interface E { a: int; ${name}: string; ${name}2?: boolean; z: int; }`,
		);
		const m = types.get("E").members;
		assertEqual(Object.keys(m).join(","), `a,${name},${name}2,z`);
		assertEqual(m[name].name, "string");
	}
});

test("a keyword-named method keeps its neighbours and its signature", () => {
	for (const name of NAMES) {
		const { types } = parseDts(
			`interface E { a: int; ${name}(x: int): string; z: int; }`,
		);
		const m = types.get("E").members;
		assertEqual(Object.keys(m).join(","), `a,${name},z`);
		assertEqual(m[name].kind, "func");
	}
});

test("a keyword-named member is optional like any other", () => {
	const { types } = parseDts("interface E { type?: string; static?(): void; }");
	assertEqual(Object.keys(types.get("E").members).join(","), "type,static");
});

test("modifiers before a member name are still skipped", () => {
	const { types } = parseDts(
		"declare class E { readonly a: int; static b: int; private c(): void; readonly type: string; }",
	);
	assertEqual(Object.keys(types.get("E").members).join(","), "a,b,c,type");
});

test("a construct signature is not a member named new", () => {
	const { types } = parseDts(
		"declare class E { new(a: int): E; type: string; }",
	);
	assertEqual(Object.keys(types.get("E").members).join(","), "type");
});

test("a keyword-named member is read in a program", () => {
	const { js, errors } = compileDts(
		"interface Ev { type: string; class(): string; }\ndeclare function make(): Ev;",
		`package main

import "js:./types.d.ts"

func main() {
	e := make()
	var t string = e.type
	println(t, e.class())
}`,
	);
	assertEqual(errors.length, 0);
	assert(js.includes("e.type"), js);
});

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	process.exit((await summarize()) > 0 ? 1 : 0);
}
