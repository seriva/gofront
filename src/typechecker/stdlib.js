// stdlib.js — built-in namespace and browser-global registration for the GoFront type
// checker. Called once from TypeChecker._setupGlobals() during construction.
//
// Delegates to two focused sub-modules:
//   stdlib/core.js     — browser globals, fmt, strings, bytes, strconv, sort,
//                        math, errors, time, unicode, os, slices, html, io
//   stdlib/extended.js — gom, maps, regexp, rand, utf8, path, builder types,
//                        built-in functions

import { setupCoreGlobals } from "./stdlib/core.js";
import { setupExtendedGlobals } from "./stdlib/extended.js";

export function setupGlobals(globals, types) {
	setupCoreGlobals(globals, types);
	setupExtendedGlobals(globals, types);
}
