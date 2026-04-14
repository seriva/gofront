// GoFront test suite — orchestrator
// Imports all split test files in order and prints a combined summary.
// Run individual suites directly:  node test/language.test.js
//
// Test files:
//   language.test.js    — core language features
//   types.test.js       — type system and type checking
//   structs.test.js     — structs, embedded structs, methods
//   builtins.test.js    — built-in functions and operators
//   compiler.test.js    — multi-file, CLI, npm resolver
//   dom.test.js         — DOM and external .d.ts
//   lexer-parser.test.js — lexer, parser, dts-parser, codegen

import "./language.test.js";
import "./types.test.js";
import "./structs.test.js";
import "./builtins.test.js";
import "./compiler.test.js";
import "./dom.test.js";
import "./lexer-parser.test.js";

import { summarize } from "./helpers.js";

process.exit(summarize() > 0 ? 1 : 0);
