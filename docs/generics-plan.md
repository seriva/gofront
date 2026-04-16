# Generics Implementation Plan (v0.0.5)

## Key Insight

Type erasure is free — `func Map[T, U any](...)` becomes `function Map(...)` in JS.
All complexity is in the compiler front-end. CodeGen changes are minimal.

No new runtime helpers are needed.

---

## New AST Nodes

```js
{ kind: "TypeParam",         name: string, constraint: TypeNode | null }
{ kind: "UnionConstraint",   terms: Array<{ tilde: bool, type: TypeNode }> }
{ kind: "InstantiationExpr", expr: ExprNode, typeArgs: TypeNode[] }
{ kind: "GenericTypeName",   name: string, typeArgs: TypeNode[] }

// Existing nodes get a new optional field:
FuncDecl  → add typeParams: TypeParam[] | null
TypeDecl  → add typeParams: TypeParam[] | null
```

---

## New Type Kinds (`src/typechecker/types.js`)

```js
{ kind: "typeParam", name: string, constraint: Type }
{ kind: "generic",   name: string, typeParams: [...], funcType?: FuncType, declNode? }
```

Add `COMPARABLE` constant and `isTypeParam()`, `isGeneric()` helpers. Update `typeStr()` for both.

---

## Phase 1 — Lexer (trivial, ~1h)

**File:** `src/lexer.js`

The `~` character currently throws. Add:
- `TILDE: "~"` to the `T` token constants
- `case "~": this.push(T.TILDE, "~", l, c); break;` in `tokenize()`

That is the only lexer change.

---

## Phase 2 — Parser: type declarations and signatures (~half day)

**Files:** `src/parser/types.js`, `src/parser.js`

1. Add `parseTypeParamList()` to `typeParserMethods` — consumes `[T any, U Stringer]`:
   ```
   expect [ → loop: expect IDENT + parseConstraint() → expect ]
   ```

2. Add `parseConstraint()` — handles `any`, named interfaces, and union constraints:
   ```
   loop: optional TILDE + parseType(), separated by |
   if single non-tilde term → return it directly
   else → return UnionConstraint node
   ```

3. Update `parseTypeName()` (`src/parser/types.js`) — after parsing the name, check for `[`
   to emit `GenericTypeName`:
   ```
   if check(LBRACKET) → consume [, parse comma-separated types, expect ] → GenericTypeName
   ```

4. Update `parseFuncOrMethod()` (`src/parser.js`) — after the function name, check for `[`
   before parsing the signature:
   ```js
   const typeParams = this.check(T.LBRACKET) ? this.parseTypeParamList() : null;
   ```

5. Update `parseTypeDecl()` (`src/parser.js`) — same pattern after the type name.

---

## Phase 3 — Parser: call-site disambiguation (~half day, highest risk)

**File:** `src/parser/expressions.js`

`Foo[int](42)` and `Foo[0]` are syntactically identical until you look further. Add a
lookahead function `looksLikeTypeArgList(startPos)` that:

1. Scans forward from the position after `[`
2. Accepts only type tokens: `IDENT`, `STAR`, `MAP`, `FUNC`, `INTERFACE`, `STRUCT`,
   `COMMA`, `DOT`, type keywords
3. Rejects any literal (`INT`, `STRING`, etc.) → it is an index expression
4. On finding a depth-0 `]`, checks if the next token is `(` or `{`
5. Returns true only in that case

In `parsePostfix()`, replace the bare `LBRACKET` handler with:
```js
if (expr.kind === "Ident" && this.looksLikeTypeArgList(this.pos + 1)) {
  // parse type args → InstantiationExpr
} else {
  // existing index/slice logic
}
```

Also update `isCompositeLitContext()` to include `InstantiationExpr` so `Stack[string]{}`
parses correctly.

**Corner cases to explicitly test:**

| Expression | Expected result |
|---|---|
| `Foo[0]` | Index (int literal rejects type-args path) |
| `Foo[x]` not followed by `(` | Index |
| `Foo[int](42)` | InstantiationExpr + CallExpr |
| `Foo[string]{}` | InstantiationExpr + CompositeLit |
| `a[b[0]]` | Nested index, not type args |

---

## Phase 4 — TypeChecker: foundations (~half day)

**Files:** `src/typechecker/types.js`, `src/typechecker.js`

1. Add `typeParam` and `generic` to `typeStr()`
2. Add `isTypeParam()`, `isGeneric()`, `COMPARABLE`
3. Update `resolveTypeNode()`:
   - `TypeName` case: check current scope for type params before checking `this.types`
   - Add `GenericTypeName` case: calls new `instantiateGenericType()`
4. Add `resolveConstraint(node, scope)` — resolves constraint nodes to type objects
5. Update `assertAssignable()` — add early return when either side is a `typeParam`:
   ```js
   if (target?.kind === "typeParam" || source?.kind === "typeParam") return;
   ```

---

## Phase 5 — TypeChecker: generic declarations (~half day)

**Files:** `src/typechecker.js`

1. Update `collectFunc()` — when `decl.typeParams` is set, build a `generic` type with a
   `funcType` using `typeParam` placeholders for each parameter.

2. Update `collectType()` — when `decl.typeParams` is set, store a `generic` type with the
   `declNode` for deferred instantiation.

3. Update `checkFuncDecl()` — inject type params into the function's inner scope before
   checking params and body:
   ```js
   for (const tp of decl.typeParams ?? []) {
     inner.define(tp.name, { kind: "typeParam", name: tp.name, constraint });
   }
   ```

---

## Phase 6 — TypeChecker: inference and instantiation (full day, hardest)

**Files:** `src/typechecker.js`, `src/typechecker/expressions.js`

### `instantiateGenericFunc(genericType, typeArgs)`

Builds a substitution map `{ T → int, U → string }` and walks the `funcType` replacing
all `typeParam` occurrences recursively. Returns a concrete `func` type.

### `instantiateGenericType(genericType, typeArgNodes, scope)`

Same substitution approach but for struct types. Returns a `named` type with the
instantiated underlying struct.

### `inferTypeArgs(genericType, argTypes)` — the inference algorithm

Constraint unification: walk `(paramType, argType)` pairs in parallel. When a `typeParam`
is encountered on the param side, record `T → argType` in a map. Recurse into
`slice`/`map`/`func` composite types. Handle conflicts by falling back to `ANY`. Apply
`defaultType()` to all results (so `UNTYPED_INT` → `INT`). Return `null` if any type
param was not resolved.

### Update `checkCall()`

```
if expr.func is InstantiationExpr:
  → resolve explicit type args, call instantiateGenericFunc
else if fnType.kind === "generic":
  → infer type args from arg types, call instantiateGenericFunc
  → error if inference returns null
```

### `checkConstraint(typeArg, constraint, node)`

| Constraint | Behaviour |
|---|---|
| `any` | Always passes |
| `comparable` | Stub: accept all (v1) |
| `UnionConstraint` | Check if typeArg matches any term; `~` terms always pass (v1) |
| Named interface | Use existing `implements()` check |

---

## Phase 7 — CodeGen (~2h, mostly trivial)

**File:** `src/codegen/expressions.js`

1. `genCall()` — unwrap `InstantiationExpr` before generating the function expression:
   ```js
   const funcExpr = expr.func.kind === "InstantiationExpr" ? expr.func.expr : expr.func;
   ```

2. `genExpr()` — add case for standalone `InstantiationExpr`:
   ```js
   case "InstantiationExpr": return this.genExpr(expr.expr); // type erasure
   ```

3. `getTypeName()` — handle `GenericTypeName` by returning just the base name:
   ```js
   if (typeNode.kind === "GenericTypeName") return typeNode.name;
   ```

`Stack[string]{}` → `new Stack({})`. `Map[int, string](xs, f)` → `Map(xs, f)`.

---

## Phase 8 — Method receivers on generic types (~2h)

**Example:** `func (s *Stack[T]) Push(v T)`

The receiver type `Stack[T]` parses as `GenericTypeName`. In `collectFunc()` for method
decls, when the receiver type is `GenericTypeName`, look up by base name (`Stack`) and
attach the method to the underlying generic type's struct. Type params in the receiver
(`T`) become type params on the method scope during checking.

---

## Test File: `test/generics.test.js`

Register in `test/run.js`. Write in phase order — each group must pass before moving on.

### Phase 1–2: Lexer and parser structure

```js
test("lexer emits TILDE for ~")
test("parser: FuncDecl with typeParams")
test("parser: TypeDecl with typeParams")
test("parser: GenericTypeName in type position Stack[string]")
```

### Phase 3: Call-site disambiguation

```js
test("parser: Foo[int](42) → InstantiationExpr + call")
test("parser: Foo[0] → index expression, not type args")
test("parser: Foo[x] not followed by ( → index expression")
test("parser: Foo[string]{} → InstantiationExpr + composite lit")
test("parser: a[b[0]] → nested index, not type args")
```

### Phase 4–5: TypeChecker — compilation without errors

```js
test("generic func with any constraint compiles without error")
test("generic func body type-checks with T in scope")
test("generic struct declaration compiles without error")
```

### Phase 6: TypeChecker — inference and constraints

```js
test("type inference: Identity(42) infers T=int")
test("type inference: Map([]int{...}, func(int) string) infers T=int, U=string")
test("explicit type args: Foo[int](42) compiles")
test("constraint satisfied: Stringer interface")
test("constraint violated: int does not implement Stringer → error")
test("comparable constraint: Equal[T comparable](a, b T) bool")
```

### Phase 7: End-to-end output

```js
test("Identity[T any] runs correctly")
test("Map[T, U any] runs correctly")
test("Stack[T any] push/pop runs correctly")
test("explicit Wrap[string](\"hello\") runs correctly")
```

---

## Risk Summary

| Risk | Mitigation |
|---|---|
| `[` disambiguation breaks existing index/slice tests | Stress-test corner cases before Phase 4; run full suite after Phase 3 |
| Semicolon insertion after `]` at line break | Avoid multi-line type arg lists; not a real-world issue |
| Method receivers `Stack[T]` | Isolated to Phase 8; does not block earlier phases |
| `UNTYPED_INT` inferred as `T` | Apply `defaultType()` in `inferTypeArgs()` before returning |
| `typeParam` equality via `typeStr` | Short-circuit in `assertAssignable()` before reaching string comparison |

---

## V1 Scope

**In scope:**
- Generic functions: `func Foo[T any](x T) T`
- Generic structs: `type Stack[T any] struct { items []T }`
- Constraints: `any`, named interfaces, `comparable` (stub), simple union constraints (`~int | ~string`)
- Type argument inference at call sites
- Explicit instantiation: `Foo[int](42)`, `Stack[string]{}`

**Out of scope (future):**
- Method type parameters (Go does not allow these anyway)
- Complex nested constraint expressions
- `~T` underlying type constraint enforcement (accepted but not enforced in v1)
- Goroutines/channels (unrelated, already out of scope)
