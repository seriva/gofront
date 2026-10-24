# templ CSS Declarations (`css` blocks) — Design Plan

**Version:** v1.4.0
**Status:** Completed (2026-10-02)

---

## Goal

Add native support for official [templ.guide](https://templ.guide/syntax-and-usage/css-style-management) `css Name() { ... }` declarations to `.templ` files in GoFront.

This enables colocating component styles directly inside `.templ` files, generating unique scoped CSS class names at compile time, and emitting static CSS rules without runtime overhead or external CSS preprocessing dependencies.

```templ
package main

css cardStyle() {
    background-color: var(--background-color);
    border: 1px solid var(--border-color);
    border-radius: 8px;
    padding: 16px;

    &:hover {
        border-color: var(--accent);
    }

    [data-theme="light"] & {
        box-shadow: 0 2px 4px rgba(0, 0, 0, 0.08);
    }

    @media (max-width: 640px) {
        padding: 8px;
    }
}

templ Card(title string) {
    <div class={ cardStyle() }>
        <h3>{ title }</h3>
    </div>
}
```

---

## Out of Scope

- **Runtime CSS-in-JS engine:** GoFront will not parse, compute, or inject dynamic CSS rules at 60 FPS in JavaScript. All CSS rules are extracted and scoped at compile time.
- **Dynamic Go expression evaluation inside CSS bodies (Phase 1):** Upstream templ supports `{ expr }` interpolation inside CSS rules for dynamic property values. For Phase 1, dynamic theming should be accomplished via CSS Custom Properties (`var(--...)`), which requires zero JS re-rendering and integrates cleanly with existing theme systems (e.g. `theme.go`). Dynamic properties mapped to CSS variables will be evaluated in Phase 2.
- **SASS / LESS preprocessors:** Modern native CSS nesting (`&`), `@media`, and CSS variables are supported natively by all evergreen browsers and require no third-party preprocessor.

---

## Approach

### 1. Lexer (`src/templ-lexer.js`)

Introduce new token types:
- `TT.CSS_KW = "css"`
- `TT.CSS_BODY = "CSS_BODY"`

Implementation details:
1. In `TemplLexer.prototype.tokenize()`:
   - When matching keyword `"css"` at top level, emit `TT.CSS_KW` and branch to `_lexCssDecl()`.
2. In `_lexGoChunk()`:
   - When scanning ahead at depth 0, check `this._peekKeyword("templ") || this._peekKeyword("css")` to avoid consuming top-level `css` declarations as raw Go statements.
3. In `_lexCssDecl()`:
   - Scan identifier (the declaration name).
   - Consume parameter list `(` and `)`.
   - Skip whitespace and comments up to opening `{`.
   - Track nested brace depth `depth = 1` starting after `{`.
   - Scan character-by-character:
     - Skip CSS comments (`/* ... */`) to avoid miscounting braces inside comments.
     - Skip CSS string literals (`"..."`, `'...'`) to avoid miscounting braces inside content or URLs.
     - Count `{` (`depth++`) and `}` (`depth--`).
     - When `depth === 0`, the block is closed.
   - Emit `TT.CSS_BODY` containing the raw CSS string content and source line info.
   - Emit `TT.TEMPL_END` (closing brace).

### 2. Parser (`src/templ-parser.js`)

In `TemplParser.prototype.parseTopDecl`:
- If `this.check(TT.CSS_KW)` is true, branch to `parseCssDecl()`.
- `parseCssDecl()`:
  1. Consume `TT.CSS_KW`.
  2. Expect `T.IDENT` $\to$ declaration name (e.g. `cardStyle`).
  3. Expect `T.LPAREN` and `T.RPAREN` (Phase 1: parameterless).
  4. Expect `T.LBRACE`.
  5. Consume `TT.CSS_BODY` $\to$ `cssText`.
  6. Expect `TT.TEMPL_END` / `T.RBRACE`.
  7. Return AST node:
     ```js
     {
       kind: "CssDecl",
       name: "cardStyle",
       params: [],
       cssText: "...",
       _line: line
     }
     ```

### 3. Type Checker (`src/typechecker/index.js` & `src/typechecker/resolve.js`)

During Pass 2 (collecting top-level declarations):
- For each `CssDecl` node:
  - Register `name` as a callable function symbol in the current package scope:
    - Signature: `func() string`
  - Obey Go visibility conventions: if `name` starts with an uppercase letter, it is marked as exported in `exportedSymbols`; if lowercase, it is package-private.
- When invoked in template expressions such as `class={ cardStyle() }` or in Go code `gom.Class(cardStyle())`, the call type-checks as returning a basic `string`.

### 4. Code Generation & Scoping (`src/codegen/templ.js` & `src/compiler.js`)

#### A. Class Name Scoping
- For each `CssDecl`, compute a deterministic short hash from the package name, function name, and CSS text.
- Generated class name format: `gfc_<name>_<hash>` (e.g. `gfc_cardStyle_9b2e`).

#### B. CSS Transformation
- Wrap the declared CSS body with the scoped class selector:
  ```css
  .gfc_cardStyle_9b2e {
      background-color: var(--background-color);
      border: 1px solid var(--border-color);
      border-radius: 8px;
      padding: 16px;

      &:hover {
          border-color: var(--accent);
      }

      [data-theme="light"] & {
          box-shadow: 0 2px 4px rgba(0, 0, 0, 0.08);
      }
  }
  ```
- Modern CSS nesting allows `&` and root-relative selectors to function without any complex AST CSS manipulation.
- Redundant comments and excess whitespace are stripped to minimize payload size.

#### C. JavaScript Function Emission
- Emit a simple, inlineable function in the generated JavaScript:
  ```javascript
  function cardStyle() {
    return "gfc_cardStyle_9b2e";
  }
  ```

#### D. Stylesheet Delivery (Compile Pipeline & CLI)
All compiled CSS rules across all `.templ` files in the package (and bundled local dependencies) are collected into a unified stylesheet.

1. **Self-Contained Module Injection (`__injectStyles`):**
   - For standalone compiles (`gofront <input> -o bundle.js`) and tests, codegen emits a tree-shaken preamble that injects the styles once into `<head>` upon module evaluation:
     ```javascript
     (function() {
       if (typeof document === "undefined") return;
       let s = document.getElementById("gofront-styles");
       if (!s) {
         s = document.createElement("style");
         s.id = "gofront-styles";
         document.head.appendChild(s);
       }
       s.textContent += "\n/* ... */\n";
     })();
     ```
   - This ensures standalone bundles run with 0 extra configuration (no manual `<link>` required in `index.html`).
2. **Project Builds (`gofront build`):**
   - The compiled CSS is returned as `compileResult.css` by `compiler.js`.
   - `handleBuild` in `cli-core.js` can write the collected styles to `outDir/app.css` (or append to existing CSS assets).
3. **Dev Server (`gofront dev`):**
   - The live reload server hot-reloads the stylesheet or streams the updated component stylesheet via Server-Sent Events (SSE).

---

## Edge Cases

1. **Nested Braces in CSS:** Media queries (`@media (max-width: 768px) { ... }`), keyframes (`@keyframes spin { 0% { ... } }`), and CSS nesting (`&:hover { ... }`) contain nested `{ ... }`. The lexer maintains brace depth counters.
2. **String Literals Containing Braces:** CSS declarations like `content: "{"` or quotes inside URL properties (`url("path/{foo}")`) are parsed as string tokens and do not affect brace depth.
3. **CSS Comments:** Comments like `/* } */` are skipped in the lexer so comment-nested braces do not affect depth tracking.
4. **Duplicate Class Names Across Packages:** Hashing with the package prefix prevents collisions when two packages both declare `css header()`.
5. **Class Combinations:** Multiple classes on one element:
   `<div class={ "custom-class " + cardStyle() }>` works naturally via string concatenation.
6. **Sub-package Dependencies:** When package A imports package B and both contain `css` declarations, all styles are collected in dependency order and deduplicated.

---

## Implementation Tasks

### Phase 1: Lexer & Parser
- [x] **Task 1.1 — CSS keyword and body tokens:** Add `TT.CSS_KW` and `TT.CSS_BODY` brace-counting scanning in `src/templ-lexer.js`.
- [x] **Task 1.2 — `CssDecl` AST node:** Parse top-level `css Name() { ... }` declarations in `src/templ-parser.js`.

### Phase 2: Type Checking & Scope
- [x] **Task 2.1 — Scope registration:** Register `css` declarations as package-scoped callables returning `string` in `src/typechecker/index.js`.
- [x] **Task 2.2 — Attribute integration:** Validate `cssName()` calls in `class={ ... }` and `gom.Class(...)`.

### Phase 3: CodeGen & Stylesheet Emission
- [x] **Task 3.1 — Scoped class hashing:** Emit deterministic `gfc_<name>_<hash>` class identifiers.
- [x] **Task 3.2 — Scoped stylesheet generation:** Emit scoped CSS rules and runtime injection via `<style id="gofront-styles">`.
- [x] **Task 3.3 — CLI build integration:** Collect extracted styles into build output in `compiler.js` and `cli-core.js`.

---

## Test Plan

### Unit Tests (`test/unit/templ.test.js`)
- **Lexer:**
  - Tokenize `css name() { ... }` with simple properties.
  - Tokenize with nested braces (CSS nesting, media queries).
  - Tokenize with strings containing braces and quotes.
  - Tokenize with multiline comments containing braces.
  - Error diagnostic when CSS block is unclosed before EOF.
- **Parser:**
  - Parse `CssDecl` node structure, name, line number, and body.
  - Verify rejection of invalid syntax.
- **TypeChecker:**
  - Verify `cssName()` is callable and resolves to `string`.
  - Verify error when calling non-existent CSS declaration.
  - Verify `cssName` passed to `class={ ... }` and `gom.Class(...)`.
  - Verify exported (`CssName`) vs unexported (`cssName`) rules across package boundaries.
- **CodeGen:**
  - Verify generated JS returns the hashed class name.
  - Verify scoped CSS wrapper rule is emitted.
  - Verify DOM mounting with `runInDom`: check element has generated class and `<style id="gofront-styles">` contains rules in `<head>`.
  - Verify CSS nesting and media queries are preserved.

### Integration / E2E Tests
- Render a `.templ` component with `css` declaration in Playwright.
- Verify `window.getComputedStyle(element)` matches expected values.
- Verify theme switching via CSS variables updates element styles dynamically without JS re-rendering.

