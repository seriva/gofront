// GoFront test suite — orchestrator
// Imports all split test files in order and prints a combined summary.
//
// Test directories:
//   language/     — core language features, control flow, declarations, expressions
//   types/        — type errors, type checks, type inference
//   structs/      — structs, embedded structs, methods (single file)
//   builtins/     — built-in functions, operators, stdlib shims
//   compiler/     — multi-file packages, CLI, imports
//   dom/          — DOM and external .d.ts (single file)
//   lexer-parser/ — lexer, parser, dts-parser, codegen (single file)

import "./language/core.test.js";
import "./language/control-flow.test.js";
import "./language/declarations.test.js";
import "./language/expressions.test.js";
import "./language/range-iter.test.js";
import "./language/pointers.test.js";
import "./language/named-type-methods.test.js";
import "./types/errors.test.js";
import "./types/checks.test.js";
import "./types/inference.test.js";
import "./types/arrays.test.js";
import "./types/complex.test.js";
import "./types/generics.test.js";
import "./structs.test.js";
import "./builtins/core.test.js";
import "./builtins/operators.test.js";
import "./builtins/stdlib.test.js";
import "./builtins/bytes.test.js";
import "./compiler/packages.test.js";
import "./compiler/cli.test.js";
import "./compiler/imports.test.js";
import "./builtins/gom.test.js";
import "./dom.test.js";
import "./lexer-parser.test.js";
import "./minifier.test.js";

import { summarize } from "./helpers.js";

process.exit(summarize() > 0 ? 1 : 0);
