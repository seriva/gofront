// stdlib.js — built-in namespace and browser-global registration for the GoFront type
// checker. Called once from TypeChecker._setupGlobals() during construction.
//
// Delegates to two focused sub-modules:
//   stdlib/core.js     — browser globals
//   stdlib/extended.js — built-in functions

import { setupCoreGlobals } from "./core.js";
import { setupExtendedGlobals } from "./extended.js";
import { setupSharedGlobals } from "./shared.js";
import { setupSimdGlobals } from "./simd.js";
import { setupWebGlobals } from "./web.js";

export function setupGlobals(globals, types) {
	setupCoreGlobals(globals);
	setupExtendedGlobals(globals);
	setupSharedGlobals(globals, types);
	setupSimdGlobals(globals, types);
	setupWebGlobals(globals, types);
}
