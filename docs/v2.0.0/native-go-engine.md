# Native Go Compiler Engine — Design Plan

**Version:** v2.0.0  
**Status:** Draft (revised 2026-10-20)  
**Baseline Spec:** v1.8.0, the **last feature release of the JS engine**. It comprises:

- the v1.4.0 language (incl. `.templ` scoped `css`);
- the complete hybrid JS + WASM compiler from v1.5.0–v1.6.1 (`src/lower/`, package targets, JS strict mode, full WASM backend, boundary, shared buffers);
- v1.7.0: compile-time `encoding/json`, `.d.ts` tuple returns, Preact integration, experimental `gofront/simd`;
- v1.8.0: WASM language parity (array value semantics, pointers to scalar fields/elements, range-over-func, generic func types, complex numbers, predeclared-name shadowing), the Go-source stdlib with overlays and the coverage manifest, `iter`/`cmp`, `bufio`/`net/url`/`context`, `encoding/csv` and the other new pure packages, `encoding/json` in WASM, and the completed `gofront/simd`.

See [`docs/v1.6.1/wasm-gaps-plan.md`](../v1.6.1/wasm-gaps-plan.md), [`docs/v1.7.0/json-preact-simd-plan.md`](../v1.7.0/json-preact-simd-plan.md) and [`docs/v1.8.0/portable-go-plan.md`](../v1.8.0/portable-go-plan.md).

**Prerequisite:** v1.8.0 released. The JS engine is feature-frozen from that release on (see [Cutover & Coexistence](#cutover--coexistence)). The port starts from a feature-complete JS compiler and adds no features. Phases 0–2 (oracle, lexer, parser) may start earlier, because v1.8.0 adds no syntax.

---

## Goal

Rewrite GoFront's compiler core and CLI from Node.js into a native Go binary (`cmd/gofront`) that produces **the same JavaScript output, the same WebAssembly output, the same diagnostics, and the same CLI behaviour** as the v1.8.0 JS engine.

Motivation:

1. **Compilation speed.** Remove V8 startup, JIT warm-up and GC pauses from every compile. The *target* is sub-10 ms incremental rebuilds in `gofront dev` for projects the size of `simplefps`. Phase 0 records a baseline for the JS engine so this claim is measured, not assumed.
2. **No Node.js for the core loop.** `dev`, `build` (without vendor deps) and `check` run from one static binary (`go install github.com/seriva/gofront/cmd/gofront@latest` or a GitHub release). See [Node.js dependency matrix](#nodejs-dependency-matrix) for the commands that still need Node.
3. **Unchanged npm workflow.** `npm i -g gofront` / `npx gofront` keep working. As with `esbuild` and `biome`, the npm package becomes a thin launcher that runs a prebuilt platform binary (`@gofront/linux-x64`, `@gofront/darwin-arm64`, `@gofront/windows-x64`, …) installed through `optionalDependencies`.
4. **Maintainability.** Statically typed AST/type structs and exhaustive type switches replace ad-hoc JS objects whose fields get mutated during compilation (`_type`, `_lvalue`, `_className`).
5. **Multiple backends.** v1.5.0–v1.8.0 build the shared lowering step (`src/lower/`) and the complete WASM backend in the JS compiler. The port carries both over as `internal/lower` + `internal/backend/{js,wasm}`, so later backend work happens in Go.

**Done means:** every test in the existing unit, examples, E2E and v1.8.0 conformance suites (JS and hybrid) passes against the native engine, `simplefps` builds and runs as a hybrid app, and the npm package ships the native binary by default.

---

## Out of Scope

- **Language changes.** v2.0.0 is a port. New syntax, semantics, stdlib surface or WASM features wait for later releases. Known v1.8.0 quirks are ported *as-is* and logged in an issue list for v2.x.
- **Stdlib surface.** The v1.8.0 coverage manifest (`runtime/stdlib/manifest.json`) is the frozen stdlib surface. Entries marked excluded stay excluded with the same diagnostics. `gofront/simd` keeps the stable/experimental status decided in v1.8.0.
- **Porting the Go-source stdlib.** Packages and overlays written in GoFront Go in v1.8.0 are not ported. The native engine compiles the same files (see [§5](#5-types--checker-internaltypes-internalcheck)).
- **Rewriting vendor bundling.** `gofront prep` / `vendor` (and the vendor step of `build`) keep using [`src/vendor.js`](../../src/vendor.js), which loads Rolldown or esbuild from the consumer's devDependencies.
- **Running JS without Node.** `gofront test` runs compiled JS (and JSDOM with `--dom`) in Node. It is not ported to an embedded engine (see [Rejected alternatives](#rejected-alternatives)).
- **Using `go/parser` / `go/ast` / `go/types`.** They implement the Go spec exactly and reject GoFront extensions (`async`/`await`, `.templ`, `css`, `js:` imports, browser globals). GoFront keeps its own hand-written parser and checker. `go/constant` and `math/big` *may* be used for constant evaluation (see §5).
- **Concurrency runtime.** Goroutines, channels, `select`, `goto`, `unsafe`, `reflect` and `cgo` stay unsupported, with the same targeted error messages as today.
- **Parser error recovery.** The JS parser stops at the first error (`ParseError`). The port matches that. Multi-error recovery is a v2.x improvement once parity is locked.

---

## Node.js Dependency Matrix

| Command | Native binary alone | Needs Node | Why |
|---|---|---|---|
| `gofront check` | ✓ | | Pure compile |
| `gofront <input> [-o] [--watch] [--serve] [--minify] [--source-map]` | ✓ | | Pure compile + dev server |
| `gofront dev` | ✓ | | Compile, watch, serve, asset sync |
| `gofront build` (no npm `dependencies`) | ✓ | | Compile, minify, assets, PWA |
| `gofront build` (with npm `dependencies`) | | ✓ | Vendor step delegates to `src/vendor.js` |
| `gofront build --release` / `--wasm-opt` (hybrid app) | ✓ with `wasm-opt` on `PATH` | ✓ otherwise | Binaryen. Today `optimize.js` prefers a native `wasm-opt` and falls back to the `binaryen` npm package, which runs in Node. The native engine keeps that order. |
| `gofront build --emit-wat` | ✓ | | WAT printer is part of the port |
| `gofront prep` / `vendor` | | ✓ | Rolldown/esbuild from devDependencies |
| `gofront test [--dom]` | | ✓ | Executes compiled JS (and JSDOM) |
| `gofront init` | ✓ | | Scaffolding |

If Node is missing (or, for `--release`, neither `wasm-opt` nor Node is available), the native binary prints a clear message naming the command and the reason. The npm launcher finds the Node-side scripts relative to its own install, so `npx gofront prep` works with no extra configuration.

---

## Architecture Overview

```
 .go / .templ / .d.ts
        │
        ▼
 ┌─────────────┐  tokens  ┌─────────────┐  AST  ┌──────────────────┐  AST + Info  ┌──────────────┐  lowered tree  ┌──────────────────┐
 │ lexer       │ ───────► │ parser      │ ────► │ typechecker      │ ───────────► │ lower        │ ─────────────► │ backend          │
 │ • Go ASI    │          │ • Go exprs  │       │ • 4 passes       │              │ • clone      │                │ • js             │
 │ • templ/css │          │ • generics  │       │ • generics       │              │   elision    │                │ • wasm (full     │
 │ • directives│          │ • templ/css │       │ • stdlib + web   │              │ • boxing     │                │   hybrid, from   │
 └─────────────┘          └─────────────┘       │ • .d.ts types    │              │ • captures   │                │   v1.8.0)        │
                                                │ • pkg targets    │              │ • escape     │                └────────┬─────────┘
                                                └──────────────────┘              │ • range/defer│                         │
                                                                                  └──────────────┘                         ▼
                                                                                                        JS + CSS + source map + .wasm
```

- **`Info` side table.** The checker writes results into a `types.Info` (similar to `go/types`) rather than mutating AST nodes, e.g. `Types map[ast.Expr]TypeAndValue`, `Defs`, `Uses`, `Boxed map[*ast.Ident]bool`, `Instances` and package targets.
- **`lower`.** A **port** of `src/lower/` (introduced in v1.5.0, where it already produces side tables instead of AST mutations): clone elision (ownership/mutation analysis), address-taken boxing, captured-and-mutated variables, pointer-retention escape analysis, embedded promotion, range-loop shape, `defer`/`recover` structure, named-return pre-declaration, array clone elision (v1.8.0), and reachability for Go-source stdlib packages (v1.8.0). The port is mechanical, since the design work happened in the JS engine.
- **`backend` interface.** `Emit(pkg *lower.Package) (Output, error)`. v2.0.0 ships `backend/js` and `backend/wasm` (the complete v1.8.0 backend, ported as-is).

### Repository Layout

A single Go module at the repo root (`github.com/seriva/gofront`). Packages live under `internal/`, so the compiler exposes no public Go API until one is deliberately designed. The GoFront Go files under `runtime/stdlib/` and `test/conformance/` carry a `//go:build gofront` constraint, so `go build ./...` and `go vet ./...` ignore them. They are GoFront input, not Go packages of this module.

```
cmd/gofront/            CLI entry
internal/token          tokens, positions
internal/lexer          Go lexer + templ/css dual-mode lexer + //gofront: directives
internal/ast            AST nodes
internal/parser         parser (Go + templ/css)
internal/types          type representation, universe, Info
internal/check          type checker (passes, assignability, termination, generics, target rules)
internal/stdlib         typings for stdlib shims, browser globals, WebGL/WebGPU
internal/dts            .d.ts parser
internal/resolve        package loading, import resolution, npm/@types lookup, target graph
internal/lower          shared lowering + analyses (port of src/lower/)
internal/backend/js     JS emitter (incl. strict numeric mode), stdlib codegen, templ codegen, source maps
internal/backend/wasm   WASM codegen, binary encoder, WAT printer, JS facades + loader (port of src/backend/wasm/)
internal/minify         minifier/mangler
internal/devserver      HTTP + SSE live reload, watcher
internal/cli            command parsing, project config, assets, PWA
runtime/js/*.js         JS runtime helpers (single source of truth, see §6)
runtime/js/wasm/*.js    WASM host imports + boundary glue (single source of truth, see §6b)
runtime/stdlib/         Go-source stdlib packages + overlays + manifest.json (from v1.8.0; shared, not ported, see §5)
test/oracle/            differential harness
test/conformance/       v1.8.0 conformance fixtures with real-Go expected output
```

---

## Subsystem Specifications

### 1. Tokens & Positions (`internal/token`)

```go
type Pos struct{ File *File; Offset int } // Line/Col computed lazily from a per-file line table

type Token struct {
    Kind    Kind
    Literal string
    Pos     Pos
}
```

- **Go tokens:** literals (`INT`, `FLOAT`, `IMAG`, `CHAR`, `STRING`, `RAW_STRING`, `IDENT`), all Go keywords **including** `go`, `chan`, `select` and `goto` (lexed so the parser can report "goroutines are not supported in GoFront" etc.), all operators including `&^`, `&^=`, `<-`, `~` (constraint unions), `...`, `++` and `--`.
- **GoFront extensions:** `async`, `await`.
- **templ/css:** `templ`, `css` and the HTML/directive tokens produced by the templ lexer.
- **Column semantics:** match the JS lexer exactly (UTF-16 vs byte columns must agree with existing diagnostics, since caret alignment is tested). Phase 1 settles this.

### 2. Lexer (`internal/lexer`)

- UTF-8 scanner with small fixed lookahead (multi-char operators need at most 3 runes).
- **ASI:** Go spec rule. At newline or EOF, insert `;` if the last token was an identifier, a literal, `break`/`continue`/`fallthrough`/`return`, or `++ -- ) ] }`.
- Numeric literals: `0b`, `0o`, `0x`, legacy octal, `_` separators, imaginary suffix `i`.
- **templ dual mode** (port of `src/templ-lexer.js`):
  - Go mode until `templ Name(...) {`. HTML mode inside.
  - HTML mode: tags, self-closing tags, static, dynamic (`attr={expr}`) and conditional (`attr?={cond}`) attributes, `{ expr }` interpolation, `@Comp(args)`, `@templ.Raw(...)`, directives `if / else if / else / for / switch`, SVG namespace handling.
  - CSS mode (`css Name() {`): raw text with brace-depth tracking that ignores braces inside strings and comments, supporting nesting (`&`), pseudo-classes and `@media`.

### 3. AST (`internal/ast`)

Interfaces `Node`, `Expr`, `Stmt`, `Decl`, `TemplNode` with unexported marker methods, so type switches can be exhaustive.

- **Declarations:** `FuncDecl` (`Recv`, `TypeParams`, `Async`), `GenDecl` for `type`/`var`/`const`/`import` groups (with `iota` index), `TemplDecl`, `CssDecl`.
- **Types:** `Ident`, `SelectorExpr` (qualified), `ArrayType` (incl. `[...]T`), `SliceType`, `MapType`, `PointerType`, `FuncType`, `StructType` (embedded fields, tags), `InterfaceType` (methods, embeds, type-set unions `~int | ~float64`), `IndexExpr`/`IndexListExpr` for instantiation.
- **Statements:** `Block`, `Expr`, `Assign` (`=`, `:=`, op-assign), `IncDec`, `If` (init), `For` (C-style / cond / infinite), `Range` (incl. range-over-int and range-over-func), `Switch` (init, tagless), `TypeSwitch`, `Return`, `Branch` (`break`/`continue` with label, `fallthrough`), `Labeled`, `Defer`, `Decl`.
- **Expressions:** `Ident`, `BasicLit`, `CompositeLit` (keyed/positional, elided types), `FuncLit` (`Async`), `Paren`, `Selector`, `Index`, `IndexList`, `Slice` (2/3-index), `TypeAssert`, `Call` (with `...` spread), `Star`, `Unary`, `Binary`, `KeyValue`, `Await`.
- **templ nodes:** `TemplElement` (static, dynamic and boolean attrs, children), `TemplText`, `TemplExpr`, `TemplComponent`, `TemplChildren`, `TemplIf`, `TemplFor`, `TemplSwitch`, `TemplRaw`. `CssDecl` holds params and raw CSS text. The scoped class name is computed in codegen, not stored on the node.

### 4. Parser (`internal/parser`)

- Recursive descent with precedence climbing for binary expressions. Go has **five** binary levels. Assignment is a statement, not an operator:

  | Prec | Operators |
  |---|---|
  | 5 | `*` `/` `%` `<<` `>>` `&` `&^` |
  | 4 | `+` `-` `\|` `^` |
  | 3 | `==` `!=` `<` `<=` `>` `>=` |
  | 2 | `&&` |
  | 1 | `\|\|` |

  Unary: `+ - ! ^ * &` and `await`. Postfix: call, index/instantiate, slice, selector, type assertion.
- **Known ambiguities to replicate:**
  - Composite literals in `if`/`for`/`switch` headers (Go's `exprLev` rule: `if x == T{} {` needs parens).
  - `a[b](c)` index vs. generic instantiation. Parsed generically, resolved by the checker.
  - Type-switch guard `v := x.(type)` only in switch headers.
- **Errors:** single `ParseError` with file, line, column and caret, byte-identical to the JS engine. `go`, `chan`, `select` and `<-` produce the existing targeted messages.
- Templ/css declarations are parsed by `parser/templ.go` (port of `src/templ-parser.js`). Embedded `{ expr }` streams go back through the Go expression parser.

### 5. Types & Checker (`internal/types`, `internal/check`)

```go
type Type interface{ Underlying() Type; String() string }

type Basic     struct{ Kind BasicKind; Info BasicInfo; Name string } // incl. untyped kinds, complex64/128
type Array     struct{ Len int64; Elem Type }
type Slice     struct{ Elem Type }
type Map       struct{ Key, Elem Type }
type Pointer   struct{ Elem Type }
type Struct    struct{ Fields []*Var; Tags []string }                // fields only; methods live on Named
type Interface struct{ Methods []*Func; Embeds []Type; TypeSet *TypeSet }
type Signature struct{ TypeParams []*TypeParam; Params, Results *Tuple; Variadic, Async bool }
type Tuple     struct{ Vars []*Var }
type Named     struct{ Obj *TypeName; TypeArgs []Type; underlying Type; Methods []*Func }
type TypeParam struct{ Obj *TypeName; Constraint Type; Index int }
type Union     struct{ Terms []*Term }                                // ~T | U
type External  struct{ /* JS type from .d.ts or browser globals; TAINTED_ANY semantics */ }
```

**Passes** (mirrors `TypeChecker.checkAll`, run across all files of a package before moving to the next pass):

1. **Types.** Collect `type` declarations, resolve forward/recursive references, reject invalid value cycles, unroll aliases.
2. **Functions & methods.** Signatures (incl. type params and constraints), receiver attachment (`T` vs `*T`), generic receivers. Registers `templ` components as `func(...) gom.Node` and `css` decls as `func() string`.
3. **Embedding.** Promote embedded fields and methods.
4. **Package vars & consts.** Ordered by dependency, untyped constants, `iota`.
5. **Bodies.** Statements and expressions, lexical scopes, assignability (untyped promotion, interface satisfaction, pointer-receiver method sets), generic inference and instantiation, labels and `break`/`continue`/`fallthrough` validity, termination analysis ("missing return"), unused locals ("declared and not used") and unused imports ("imported and not used"), exported/unexported enforcement (exempt for `.d.ts`/npm namespaces).

**Constant evaluation.** Untyped constants keep arbitrary precision (`go/constant` is fine). Where the JS engine's behaviour differs (overflow detection, float formatting), match the JS engine first and log the difference.

**Built-in registry (`internal/stdlib`)**, ported from `src/typechecker/stdlib/{core,extended,web,shared,simd}.js`:
- Builtins: `len cap append copy make new delete panic recover clear min max print println complex real imag`.
- **Emitter-backed packages** (hand-written typings and codegen, ported): every manifest entry with implementation `emitter`. As of v1.7.0: `fmt strings bytes strconv sort math math/bits math/rand time slices maps errors path path/filepath regexp html io os unicode unicode/utf8 sync crypto/rand crypto/sha256 encoding/binary encoding/hex encoding/base64 encoding/json testing gom gofront/shared gofront/simd`.
- **Go-source packages and overlays** (`runtime/stdlib/`, from v1.8.0): loaded through `internal/resolve` like local packages and type-checked from source, embedded with `//go:embed`. There are no typings to port. The checker must support overlay merging into emitter-backed namespaces and the closed `//gofront:intrinsic` set.
- **Scopes:** predeclared identifiers and browser globals live in the universe scope, so package and local declarations shadow them (v1.8.0).
- The coverage test from v1.8.0 runs against both engines, so a missing port of an emitter-backed member fails CI.
- Browser and graphics: `document`, `window`, `console` and friends (as `any`), plus full typings for `WebGLRenderingContext`, `WebGL2RenderingContext`, `GPUDevice`, `GPUAdapter`, `GPUQueue`, `ArrayBuffer`, `DataView` and all TypedArrays.

Prefer table-driven definitions (Go struct literals or `//go:embed`ed data) over hand-written per-function code.

### 6. JavaScript Backend (`internal/backend/js`)

The output must match the v1.8.0 engine. The oracle enforces this. Mappings that need care:

| Area | Current behaviour to reproduce |
|---|---|
| Structs | ES6 classes with zero-value constructor defaults and a generated `__clone()`. Constructor shape exactly as current codegen. |
| Value semantics | Clone on assign, call, return, `append`, `range` **unless elided** by the ownership/mutation analysis (`_fnMutates`, `_markOwnership`, `_nodeMutatesVar`). Clone elision is part of `lower` and must match exactly. |
| Pointers | Address-taken scalars boxed as `{ value: T }`. `new(T)` gives a boxed zero value. Structs, slices and maps are references. |
| Embedding | Flattened fields + delegation stubs (`Base.prototype.M.call(this, ...a)`). |
| Named non-struct types with methods | ES6 wrapper classes (`_namedWrapperField`). |
| Interfaces | `__ifv` / `__ifp` boxing so type switches can tell `T` from `*T`. Type switches become `if/else` with `typeof`/`instanceof`. |
| Multiple results | `return [a, b]` / `let [a, b] = f()`. Named results pre-declared. |
| `defer` / `recover` | `try/finally` with a defer stack. `recover` via `catch`. |
| `range` | Slices: indexed `for` loop with hoisted array/len (zero-alloc). Maps: `Object.keys` / `Object.entries`. Strings: `Array.from` + `codePointAt`. Ints: plain `for`. Iterator funcs: yield callback with `break`/`continue`/`return` propagation. |
| Integers | `/` on ints → `Math.trunc(a / b)`. Conversions `\| 0`, `>>> 0`, `Math.trunc(Number(x))`. `a &^ b` → `(a & ~b)`. |
| TypedArrays | `[]float32`, `[]int8…int32`, `[]uint8…uint32`, `[]rune` → TypedArrays (slicing → `.subarray`). `[]float64` / `[]int` → `Array`. |
| Generics | Fully erased. |
| Identifiers | JS reserved words get a `$` suffix (`JS_RESERVED`). |
| `init()` | IIFE in declaration order. |
| `async`/`await` | Passed through. |

- **Stdlib codegen.** Port of the emitter-backed modules in `src/backend/js/stdlib/` as of v1.8.0 (30 modules plus `index.js` in v1.7.0, including the per-type `encoding/json` codec generator and the `gofront/simd` fallback). Go-source stdlib packages need no codegen port: they go through the normal pipeline. By volume this is one of the largest parts of the port and gets its own phase.
- **Runtime helpers.** `__len __append __s __sortSlice __sclone __ifv/__ifp __equal __cmul __cdiv __sprintf __error __errorIs __pathClean __timeFmt __timeParse __injectStyles`, the `__json_*` and `__simd_*` families, and the testing helpers (`__GoFront_FailNow`, …). Emitted only when used. **Move them out of `src/backend/js/runtime.js` into `runtime/js/*.js` files** that both engines load: the JS engine via `readFileSync`, the Go engine via `//go:embed`. Then they cannot drift while the two engines coexist.
- **templ.** `{ Mount(___p, ___refs) { … } }` objects building DOM via `document.createElement`, SVG via `createElementNS`.
- **Scoped CSS.** 32-bit FNV-1a over `` `${pkg}_${name}_${cssText}` ``, base-36 → `gfc_<name>_<hash>`. A class accessor function is emitted. CSS is returned as a separate `css` output (static extraction, merged across sub-packages) plus the `__injectStyles` path.
- **Source maps.** VLQ mappings, merged across preambles, inline (`--source-map`) with `sourcesContent`.

### 6b. WASM Backend Port (`internal/backend/wasm`)

A port of the complete `src/backend/wasm/` as shipped in v1.8.0, **without new features**. Design and scope: [`docs/v1.5.0/wasm-mvp-plan.md`](../v1.5.0/wasm-mvp-plan.md) (core), [`docs/v1.6.0/wasm-hybrid-plan.md`](../v1.6.0/wasm-hybrid-plan.md) (complete hybrid), [`docs/v1.6.1/wasm-gaps-plan.md`](../v1.6.1/wasm-gaps-plan.md) (remaining language, boundary and stdlib gaps), [`docs/v1.7.0/json-preact-simd-plan.md`](../v1.7.0/json-preact-simd-plan.md) (SIMD encoding) and [`docs/v1.8.0/portable-go-plan.md`](../v1.8.0/portable-go-plan.md) (language parity, WASM JSON, SIMD completion).

- **Module IR and WasmGC type mapping:** rec groups, slices, JS-string-backed strings, insertion-ordered maps, interfaces/itabs, closures, monomorphised generics.
- **Instruction emission:** structured control flow, `panic` + `defer`/`recover` (exception handling, with the encoding chosen in v1.6.0), `ref.test`/`ref.cast` type switches.
- **v1.8.0 lowering:** range-over-func closures and control-flow state, array copies, accessor-ref pointers to scalar fields/elements (box fast path via `br_on_cast`), complex `{re, im}` structs.
- **SIMD:** `v128` values, the `0xFD`-prefixed opcodes with multi-byte LEB128 sub-opcodes, `Mask32x4`, shuffles and the `gofront/shared` load/store helpers.
- **Binary encoder** (byte buffer + LEB128 + sections) and **WAT printer**.
- **Facade + loader generation** for the JS ↔ WASM boundary: values, handles, copy-in/out + retention check, numeric slices and maps, `any`, `error`, named and anonymous interface facades, pointer-to-scalar boxes, `time.Time`, callbacks both ways, `gofront/shared` linear-memory buffers. JS types implementing WASM interfaces stay rejected.
- **WASM stdlib:** the emitter mixins in `src/backend/wasm/stdlib/` (`core`, `bytes`, `pure`, `io`, `time`, `packages`, `simd`; about 22k lines in v1.7.0), the v1.8.0 JSON scanner and per-type codecs, and the synthetic runtime helpers (`emitRuntimeHelper`) are ported as Go code. Go-source stdlib packages are compiled, not ported.
- **Binaryen pipeline:** port `optimize.js` (feature flags including GC, exception handling and SIMD; `-O3 --gufa --closed-world`; `--converge` for `--release`; source-map pass-through), and invoke `wasm-opt` as an external process. The byte-identical gate applies to **unoptimized** output; optimized output is checked by validation and the runtime gate, because its bytes depend on the Binaryen version.
- **JS strict numeric mode** for `both` packages lives in `backend/js`.
- **Host imports:** the JS side of the module (`WASM_IMPORTS_JS`, `WASM_STDLIB_JS` in `boundary.js`) moves to `runtime/js/wasm/*.js` in Phase 0, like the JS runtime helpers, so both engines embed the *same files*.

### 7. Packages & Resolution (`internal/resolve`, `internal/dts`)

- **Multi-file packages:** all `.go` and `.templ` files in a directory (excluding `*_test.go` outside `test`) are parsed and checked as one unit.
- **Local packages:** `import "./sub"` compiled recursively. Output inlined as a preamble, with exported symbols and types handed to the importer. Supports aliases, `_` and `.` imports.
- **`js:` imports:** relative `.d.ts` files.
- **npm types:** walk up to `node_modules`, read `package.json` `types`/`typings`, fall back to `index.d.ts`, then `@types/<pkg>`. This is plain filesystem logic and needs no Node.
- **`.d.ts` parser:** port of `src/dts-parser.js` (`declare namespace`, `interface`, `declare function/const/var/class`, unions → `any` as today).

### 8. CLI, Dev Server, Minifier, Assets (`internal/cli`, `internal/devserver`, `internal/minify`)

- **Full CLI surface from `src/index.js`:**
  - Subcommands: `dev` (`--port`), `build` (`-o`, `--pwa`, `--source-map`, `--no-minify`, `--no-mangle`, `--emit-wat`, `--release`, `--wasm-opt`, `--no-wasm-opt`, `--js-only`/`--target js`), `check` (`dir/...`), `test` (`dir/...`, `--dom`, `-v`, `-run`), `prep`/`vendor`, `init`.
  - Legacy direct mode: `<input> [-o out.js] [--check] [--watch] [--serve [--port]] [--copy-assets] [--source-map] [--minify [--mangle]] [--ast] [--tokens]`.
  - `--version` and `--help`.
- **Project config:** `gofront.json` or a `"gofront"` key in `package.json` (`src`, `serveDir`, `outDir`, `output`, `port`, `assetExtensions`, `vendor`, `assetCopy`), with the same defaults and discovery order as `src/project-config.js`.
- **Dev server:** `net/http` static serving, SSE live reload injected into HTML, CSS hot swap without a full reload, error notification to the browser. Watcher via `fsnotify`. It is **not recursive** on Linux, so walk the tree and add new directories as they appear. Debounce 80 ms for `.go`/`.templ` and 50 ms for `.css`, as today.
- **Assets & PWA:** port `src/asset-manager.js` (built-in web asset extension list + `assetExtensions`, `assetCopy`) and `src/pwa.js` (`sw.js` + precache manifest).
- **Minifier:** port of `src/minifier.js` (whitespace/comment stripping, ASI-safe joins, local identifier mangling). Output compared byte-for-byte by the oracle.
- **Output & colours:** port `src/colors.js` formatting, including `formatDiagnostic`. CLI tests assert on this text.

---

## Differential Testing Oracle

The ~1,800+ unit tests are JS test files that call `Lexer`, `Parser`, `TypeChecker`, `CodeGen` and `compileDir` directly through [`test/unit/helpers.js`](../../test/unit/helpers.js), then run the output in `node:vm`. The oracle hooks in **at the helper layer**, so the existing tests become the parity suite without being rewritten.

```
 test/unit/*.test.js ──► helpers.js ──┬── GOFRONT_ENGINE=js      → src/* (reference)
                                      └── GOFRONT_ENGINE=native  → gofront oracle (stdin/stdout JSON, long-lived)
```

- **`gofront oracle` (hidden subcommand):** a long-lived process that reads JSON requests (`{op: "compile" | "tokens" | "check" | "compileDir", source, file, opts}`) and writes JSON responses (`{js, css, errors, tokens, mappings}`). One process per test run instead of 1,800+ spawns.
- **Comparison gates, in order of strictness:**
  1. **Tokens:** kind, literal, position, inserted semicolons. Canonical dump via `--tokens`.
  2. **Diagnostics:** message, file, line, column, caret. Byte-identical.
  3. **Emitted JS + CSS:** byte-identical. A normalising comparison (parse both with a JS parser, compare ASTs) is allowed only as a temporary escape hatch, and every use is tracked.
  4. **Emitted WASM:** `.wasm` byte-identical, with the WAT dump compared alongside for readable diffs. Facade/loader JS is covered by gate 3. There is no escape hatch: the encoder is deterministic, so any difference is a bug.
  5. **Runtime behaviour:** the existing `vm` execution assertions, the v1.5.0–v1.8.0 hybrid fixtures (JS-strict == WASM, boundary, shared buffers, stdlib parity), the v1.8.0 language parity matrix and the `test/conformance/` suite (real-Go expected output) run unchanged against native output.
- **AST dumps** are a debugging aid, not a gate. The JS AST carries codegen-time mutations (`_type`, `_lvalue`, `_className`) that the Go design deliberately drops, so forcing structural JSON parity would hold the new design hostage to the old one.
- Tests that probe internals (e.g. constructing `TypeChecker` directly) are tagged `js-only`, or get an oracle op added. The harness reports the number of skipped tests so it stays visible.
- **Beyond unit tests:** `npm run test:examples`, `test:examples:dom`, `test:e2e` (Playwright on all six examples) and the `simplefps` build + test suite all run with the native binary in CI.

---

## Cutover & Coexistence

1. **Freeze the JS engine** to bug fixes only once v1.8.0 ships; v1.8.0 is its last feature release. Any fix lands in both engines with a shared test. Patch releases (v1.8.x) are bug fixes only and move the oracle baseline with them.
2. **CI runs both engines** on every PR from Phase 1 onward. Parity percentage is reported per gate.
3. **Opt-in preview:** `GOFRONT_ENGINE=native` in the npm launcher (v2.0.0-beta).
4. **Default flip** when all gates are at 100% and `simplefps` passes. The JS engine stays available behind `GOFRONT_ENGINE=js` for one minor release, then the compiler sources in `src/` are removed. `src/vendor.js`, `src/test-runner.js`, the runtime helpers (`runtime/js/`) and the Go-source stdlib (`runtime/stdlib/`) stay.

---

## Risks

| Risk | Mitigation |
|---|---|
| Clone-elision / boxing analyses are subtle | Already extracted into `src/lower/` in v1.5.0 with side tables, so the port is mechanical. The oracle on emitted JS + WASM catches any divergence. |
| The complete WASM backend substantially enlarges the port (v1.7.0 SIMD, v1.8.0 parity work and JSON codecs) | Ported as-is (no new features). Byte-identical `.wasm` gate on unoptimized output. Host imports shared via `runtime/js/wasm/`. Its own task (5.2), so it can't stall the JS path. Per-feature oracle runs (SIMD, JSON, range-over-func). |
| v1.8.0 slips and delays the port | Phases 0–2 may start before v1.8.0 ships (no syntax changes in v1.8.0). Phase 3 onward waits for the release, because the checker and backends change in v1.8.0. |
| The Go module picks up GoFront Go files | `//go:build gofront` on every file under `runtime/stdlib/` and `test/conformance/`; a CI step runs `go vet ./...` to prove they are ignored. |
| Binaryen unavailable without Node | Prefer a native `wasm-opt` on `PATH`, fall back to the npm package through Node, then build unoptimized with a clear notice (same order as today). |
| Column/position semantics (UTF-16 vs bytes) differ silently | Settle in Phase 1 with dedicated non-ASCII fixtures. |
| Stdlib codegen volume underestimated | Separate phase, table-driven port, per-package oracle runs. |
| Performance target not met (e.g. I/O- or watcher-bound) | Phase 0 baseline + Phase 9 benchmarks. The target is a measured goal, not a promise. |
| Platform binary distribution breaks on exotic setups | Launcher falls back to a clear error with a download link. CI smoke-tests `npx gofront` on Linux, macOS and Windows. |
| Two engines drift during the port | Bug-fix freeze, shared runtime helpers, dual-engine CI. |

### Rejected Alternatives

- **Embedding a JS engine (goja, QuickJS) for `gofront test`:** goja lacks parts of modern ES and cannot run JSDOM. QuickJS needs cgo. Node is already present wherever tests run.
- **Machine-translating the JS sources:** produces unidiomatic Go and carries over the AST-mutation design this port removes.
- **Using the esbuild Go API for minification:** an attractive future option, but its output differs from the current minifier and would break byte parity. Revisit after cutover.

---

## Implementation Tasks

<!-- Native Go engine implementation roadmap -->

### Phase 0: Oracle & Baseline
- [ ] **Task 0.1 — Test harness & oracle stub:** `helpers.js` engine switch, `gofront oracle` protocol stub, shared `runtime/js/` (incl. `runtime/js/wasm/` host imports). `runtime/stdlib/` is already shared from v1.8.0.
- [ ] **Task 0.2 — Timing baseline:** Cold `check`/`build` and warm rebuild baselines on all examples and `simplefps`.

### Phase 1: Tokens & Lexer
- [ ] **Task 1.1 — Native lexer:** `internal/token` and `internal/lexer` with Go ASI, `.templ`, and scoped `css` modes (100% token parity).

### Phase 2: Parser & AST
- [ ] **Task 2.1 — Native parser:** `internal/ast` and `internal/parser` supporting generics, labels, `.templ`, and `css` blocks with identical diagnostics.

### Phase 3: Type Checker
- [ ] **Task 3.1 — Native checker:** `internal/types`, `internal/check`, `internal/stdlib` typings, `internal/dts`, and `internal/resolve`, including universe-scope predeclared names, Go-source stdlib loading, overlays and intrinsics (100% diagnostic parity; manifest coverage test green on both engines).

### Phase 4: Lowering & JS Core Backend
- [ ] **Task 4.1 — Lowering port:** Port `src/lower/` → `internal/lower` (ownership incl. array clone elision, boxing, captures, escape, range/defer shapes, Go-source stdlib reachability).
- [ ] **Task 4.2 — JS core codegen:** `internal/backend/js` with strict numeric mode, runtime helpers, and source maps (byte-identical JS).

### Phase 5: Codegen & Backends
- [ ] **Task 5.1 — Stdlib & templ codegen:** All emitter-backed JS stdlib modules (incl. `encoding/json` codecs and the `gofront/simd` fallback), templ DOM codegen, and scoped CSS (byte-identical JS + CSS).
- [ ] **Task 5.2 — WASM backend port:** `internal/backend/wasm` (IR, types, encoder, WAT, facades, WASM stdlib incl. JSON codecs and SIMD, runtime helpers, Binaryen pipeline) matching v1.8.0 unoptimized `.wasm` output byte-for-byte.

### Phase 6: CLI & Tooling
- [ ] **Task 6.1 — CLI binary & dev server:** `cmd/gofront` (full v1.8.0 flag set), config, assets, PWA, dev server, and minifier with Node delegation for `prep`/`vendor`/`test` and the Binaryen fallback.

### Phase 7: Distribution Packaging
- [ ] **Task 7.1 — npm platform packages:** Thin launcher `bin/gofront.js`, `@gofront/*` platform packages, and CI release automation.

### Phase 8: Verification & Parity
- [ ] **Task 8.1 — Full suite verification:** Playwright E2E on all six examples, the `test/conformance/` suite, `npm run bench` (raycast and SIMD particle benchmarks within noise of v1.8.0), and `simplefps` hybrid build + tests + manual 60 FPS check.

### Phase 9: Benchmarks & Default Cutover
- [ ] **Task 9.1 — Performance audit & cutover:** Measure vs Phase 0 baseline, profile hot spots, flip default engine to native Go binary.
