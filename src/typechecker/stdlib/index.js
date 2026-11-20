// stdlib.js — built-in namespace and browser-global registration for the GoFront type
// checker. Called once from TypeChecker._setupGlobals() during construction.
//
// Registers browser globals and built-in functions, then delegates to the
// shared, simd and web sub-modules.

import { ANY, BROWSER_GLOBALS, Scope } from "../types.js";
import { setupSharedGlobals } from "./shared.js";
import { setupSimdGlobals } from "./simd.js";
import { setupWebGlobals } from "./web.js";

let _universeTypeNames;
export function universeTypeNames() {
	if (!_universeTypeNames) {
		const types = new Map();
		setupGlobals(new Scope(), types);
		_universeTypeNames = [...types.keys()];
	}
	return _universeTypeNames;
}

export function setupGlobals(globals, types) {
	for (const g of BROWSER_GLOBALS) globals.define(g, ANY);
	for (const name of [
		"append",
		"len",
		"cap",
		"make",
		"delete",
		"print",
		"println",
		"panic",
		"recover",
		"new",
		"copy",
		"error",
		"min",
		"max",
		"clear",
		"complex",
		"real",
		"imag",
	])
		globals.defineBuiltin(name, { kind: "builtin", name });
	setupSharedGlobals(globals, types);
	setupSimdGlobals(globals, types);
	setupWebGlobals(globals, types);
}
