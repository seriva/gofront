// Core standard library type definitions — browser globals.

import { ANY, BROWSER_GLOBALS } from "../types.js";

export function setupCoreGlobals(globals) {
	for (const g of BROWSER_GLOBALS) globals.define(g, ANY);
}
