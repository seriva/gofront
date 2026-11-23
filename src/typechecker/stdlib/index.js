// stdlib.js — built-in namespace and browser-global registration for the GoFront type
// checker. Called once from TypeChecker._setupGlobals() during construction.
//
// Registers browser globals and built-in functions, then delegates to the
// shared, simd and web sub-modules.

import { ANY, BROWSER_GLOBALS, ES_BUILTIN_GLOBALS, Scope } from "../types.js";
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

// `webGlobalType(name)` supplies the type of a Web API global (null until the
// declarations it reads are available); the ECMAScript built-ins stay `any`.
export function setupGlobals(globals, types, webGlobalType = null) {
	for (const g of BROWSER_GLOBALS) {
		if (webGlobalType && !ES_BUILTIN_GLOBALS.has(g))
			globals.defineLazy(g, () => webGlobalType(g), ANY);
		else globals.define(g, ANY);
	}
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
