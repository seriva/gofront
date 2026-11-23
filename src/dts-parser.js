// Parses TypeScript .d.ts declaration files into GoFront's type system.
//
// Produces:
//   { types: Map<name, GoFrontType>, values: Map<name, GoFrontType> }
//
// Types / values are kept separate because TypeScript allows a name to be
// both a type alias (e.g. `export type mat4 = ...`) and a namespace
// (e.g. `export namespace mat4 { function create(): mat4 }`).
//
// Complex TypeScript types (generics, intersections, mapped types,
// conditional types, etc.) are simplified to `any`. A few forms are kept:
//   - `T | null` / `T | undefined`: T, marked `_nullable` (it may be `nil`).
//   - `Promise<T>`: `{ kind: "promise", elem: T }`; `await` yields T.
//   - `(a: A, b?: B) => R`: a `func` type marked `_dts` (a callback).
//   - `name?: T` parameters: the `func` type records `minArgs`, the number of
//     arguments a call must pass.
//   - `int`, `uint32`, `float32`, ...: the GoFront type (`number` is float64).
//   - `interface`/`class` declarations: a namespace-kind type tagged
//     `_dtsType`, with `extends` (names) and `_bases` (resolved in the file).
//
// Dictionary marker: an options object (a WebIDL dictionary) is declared with
// a `@dictionary` comment directly before its `interface`:
//
//   /** @dictionary */
//   interface BufferDescriptor { size: number; label?: string; }
//
// The type is tagged `_dictionary`. A parameter or variable of that type takes
// `nil`, a `map[string]any` literal whose constant keys are members of the
// interface (or of one it extends), and a struct value whose fields are such
// members; a member that is itself a dictionary is checked the same way. An
// interface without the comment accepts none of these.
//
// Declaration packages (`gofront/dom`, ...): `parseDeclarationPackage` parses a
// package's declarations and qualifies the type references that name one of its
// own types (`Node` becomes `dom.Node`), so the package keeps its own type table
// and a name another package or the program declares never collides with it. A
// reference written qualified (`dom.EventTarget`) names a type of another
// package, which the package lists in a header comment:
//
//   /// <reference types="gofront/dom" />

const ANY = { kind: "basic", name: "any" };
const VOID = { kind: "basic", name: "void" };

const TS_PRIMITIVES = {
	// `number` is a float64; a declaration that returns or takes a whole
	// number names the GoFront integer type instead.
	number: { kind: "basic", name: "float64" },
	int: { kind: "basic", name: "int" },
	int8: { kind: "basic", name: "int8" },
	int16: { kind: "basic", name: "int16" },
	int32: { kind: "basic", name: "int32" },
	int64: { kind: "basic", name: "int64" },
	uint: { kind: "basic", name: "uint" },
	uint8: { kind: "basic", name: "uint8" },
	uint16: { kind: "basic", name: "uint16" },
	uint32: { kind: "basic", name: "uint32" },
	uint64: { kind: "basic", name: "uint64" },
	byte: { kind: "basic", name: "uint8" },
	rune: { kind: "basic", name: "int32" },
	float32: { kind: "basic", name: "float32" },
	float64: { kind: "basic", name: "float64" },
	string: { kind: "basic", name: "string" },
	boolean: { kind: "basic", name: "bool" },
	bool: { kind: "basic", name: "bool" },
	void: VOID,
	any: ANY,
	never: ANY,
	unknown: ANY,
	object: ANY,
	null: { kind: "basic", name: "nil" },
	undefined: { kind: "basic", name: "nil" },
	symbol: ANY,
	bigint: ANY,
};

const DICTIONARY_MARK = "@dictionary";

const SKIP_MODIFIERS = new Set([
	"export",
	"declare",
	"abstract",
	"readonly",
	"static",
	"public",
	"private",
	"protected",
	"override",
]);

export class DtsParser {
	constructor(source) {
		this.src = source;
		this.pos = 0;
		this._dictEnd = null; // end of the last `@dictionary` comment
	}

	// ── Low-level helpers ────────────────────────────────────────

	eof() {
		return this.pos >= this.src.length;
	}
	ch() {
		return this.src[this.pos];
	}
	ch1() {
		return this.src[this.pos + 1];
	}

	_skipLineComment() {
		const start = this.pos;
		while (!this.eof() && this.ch() !== "\n") this.pos++;
		this._noteComment(start);
	}

	_skipBlockComment() {
		const start = this.pos;
		this.pos += 2;
		while (!this.eof() && !(this.ch() === "*" && this.ch1() === "/"))
			this.pos++;
		if (!this.eof()) this.pos += 2;
		this._noteComment(start);
	}

	// Remembers where a `@dictionary` comment (see `_parseClassDecl`) ended.
	_noteComment(start) {
		if (this.src.slice(start, this.pos).includes(DICTIONARY_MARK))
			this._dictEnd = this.pos;
	}

	// Whether the declaration starting at `declStart` follows a `@dictionary`
	// comment with nothing but whitespace between them.
	_followsDictMark(declStart) {
		return (
			this._dictEnd !== null &&
			this._dictEnd <= declStart &&
			/^\s*$/.test(this.src.slice(this._dictEnd, declStart))
		);
	}

	skip() {
		while (!this.eof()) {
			const c = this.ch();
			if (c === " " || c === "\t" || c === "\r" || c === "\n") {
				this.pos++;
				continue;
			}
			if (c === "/" && this.ch1() === "/") {
				this._skipLineComment();
				continue;
			}
			if (c === "/" && this.ch1() === "*") {
				this._skipBlockComment();
				continue;
			}
			break;
		}
	}

	peek() {
		this.skip();
		return this.eof() ? "" : this.ch();
	}

	startsWith(s) {
		return this.src.startsWith(s, this.pos);
	}

	matchKw(kw) {
		this.skip();
		if (!this.src.startsWith(kw, this.pos)) return false;
		const next = this.src[this.pos + kw.length];
		if (next && /[a-zA-Z0-9_$]/.test(next)) return false; // not a whole word
		this.pos += kw.length;
		return true;
	}

	readIdent() {
		this.skip();
		const start = this.pos;
		while (!this.eof() && /[a-zA-Z0-9_$]/.test(this.ch())) this.pos++;
		return this.src.slice(start, this.pos);
	}

	consume(ch) {
		this.skip();
		if (this.ch() === ch) {
			this.pos++;
			return true;
		}
		return false;
	}

	// Skip a string literal
	skipStringLit() {
		const q = this.ch();
		this.pos++;
		while (!this.eof() && this.ch() !== q) {
			if (this.ch() === "\\") this.pos++;
			this.pos++;
		}
		this.pos++; // closing quote
	}

	// Skip balanced <...> (generic params)
	skipGenerics() {
		if (this.peek() !== "<") return;
		let d = 1;
		this.pos++;
		while (!this.eof() && d > 0) {
			const c = this.ch();
			if (c === "<") d++;
			else if (c === ">") d--;
			else if (c === '"' || c === "'") {
				this.skipStringLit();
				continue;
			}
			this.pos++;
		}
	}

	// Skip balanced {...}
	skipBlock() {
		this.skip();
		if (this.ch() !== "{") return;
		let d = 1;
		this.pos++;
		while (!this.eof() && d > 0) {
			const c = this.ch();
			if (c === "{") d++;
			else if (c === "}") d--;
			else if (c === '"' || c === "'") {
				this.skipStringLit();
				continue;
			}
			this.pos++;
		}
	}

	_trackBracketDepth(c, depths) {
		const oi = "<([{".indexOf(c);
		if (oi >= 0) {
			depths[oi]++;
			return true;
		}
		const ci = ">)]}".indexOf(c);
		if (ci >= 0 && depths[ci] > 0) {
			depths[ci]--;
			return true;
		}
		return false;
	}

	// Skip to the end of a type expression (stops at ; | , | ) | } | { | newline-after-token)
	skipTypeExpr(stopAt = ";,)}{") {
		const depths = [0, 0, 0, 0];
		while (!this.eof()) {
			const c = this.ch();
			if (this._trackBracketDepth(c, depths)) {
				this.pos++;
				continue;
			}
			if (!depths.some(Boolean) && stopAt.includes(c)) break;
			if (c === '"' || c === "'") {
				this.skipStringLit();
				continue;
			}
			this.pos++;
		}
	}

	// ── Type parsing ─────────────────────────────────────────────

	_parseTupleElement() {
		this.skip();
		if (this.startsWith("...")) this.pos += 3;

		const savedPos = this.pos;
		const ident = this.readIdent();
		if (ident) {
			this.skip();
			if (this.ch() === "?") {
				this.pos++;
				this.skip();
			}
			if (this.ch() === ":") {
				this.pos++;
				return this.parseType(false);
			}
		}
		this.pos = savedPos;
		return this.parseType(false);
	}

	_parseTupleType(inReturn) {
		this.consume("[");
		const elements = [];
		while (!this.eof() && this.peek() !== "]") {
			this.skip();
			if (this.ch() === "]") break;
			elements.push(this._parseTupleElement());
			this.skip();
			if (this.ch() !== ",") break;
			this.pos++;
		}
		this.consume("]");
		if (inReturn) {
			return { kind: "tuple", types: elements };
		}
		return { kind: "slice", elem: ANY };
	}

	// Parse a TypeScript type expression and return a GoFront type.
	// Always returns something; falls back to ANY for complex types.
	// A union keeps its first non-null member: `T | null` is T marked
	// `_nullable`, any other union member is discarded.
	parseType(inReturn = false) {
		const first = this._parseTypeNoUnion(inReturn);
		const members = [first];

		// Union / intersection: T | U  or  T & U
		// (skip() handles multi-line unions where | is on the next line)
		this.skip();
		while (!this.eof() && (this.ch() === "|" || this.ch() === "&")) {
			const union = this.ch() === "|";
			this.pos++;
			const member = this._parseTypeNoUnion();
			if (union) members.push(member);
			this.skip();
		}
		return nullableUnion(members);
	}

	_parseTypeNoUnion(inReturn = false) {
		this.skip();

		// Skip modifiers
		while (this.matchKw("readonly") || this.matchKw("unique")) this.skip();

		// typeof X
		if (this.matchKw("typeof")) {
			this.skipTypeExpr();
			return ANY;
		}
		// keyof T
		if (this.matchKw("keyof")) {
			this.parseType();
			return ANY;
		}

		// Skip leading | or & (e.g. `export type X =\n  | T1\n  | T2`)
		this.skip();
		if (this.ch() === "|" || this.ch() === "&") this.pos++;

		let base = this._parseBaseType(inReturn);

		this.skip();
		// Array suffix: T[] or T[][]
		while (this.startsWith("[]")) {
			this.pos += 2;
			base = {
				kind: "slice",
				elem: base.kind === "tuple" ? { kind: "slice", elem: ANY } : base,
			};
			this.skip();
		}
		return base;
	}

	// `(a: A, b?: B) => R` is a function type; a parenthesized type is `any`
	// unless it groups a function type.
	_parseParenType() {
		const start = this.pos;
		this.pos++;
		this.skipTypeExpr(")");
		this.consume(")");
		this.skip();
		if (!this.startsWith("=>")) {
			// `(() => void)`: the parentheses only group a function type.
			const end = this.pos;
			this.pos = start + 1;
			const inner = this.parseType();
			this.pos = end;
			return inner.kind === "func" ? inner : ANY;
		}
		this.pos = start;
		const params = this.parseParams();
		this.skip();
		this.pos += 2; // =>
		const ret = this.parseType(true);
		return { ...funcType(params, ret), _dts: true };
	}

	_parseTemplateLit() {
		while (!this.eof() && this.ch() !== "`") this.pos++;
		this.pos++;
		return { kind: "basic", name: "string" };
	}

	_parseNumericLit() {
		while (!this.eof() && /[0-9._-]/.test(this.ch())) this.pos++;
		return { kind: "basic", name: "float64" };
	}

	_parseNamedType(name) {
		if (TS_PRIMITIVES[name]) {
			this.skipGenerics();
			return TS_PRIMITIVES[name];
		}
		if (name === "true" || name === "false")
			return { kind: "basic", name: "bool" };
		if (name === "Promise" && this.peek() === "<") return this._parsePromise();
		this.skipGenerics();
		// `pkg.T` names the type T of another declaration package or namespace.
		let qualified = name;
		while (this.ch() === ".") {
			this.pos++;
			qualified += `.${this.readIdent()}`;
		}
		return { kind: "basic", name: "any", alias: qualified };
	}

	// `Promise<T>`; `await` of it yields T.
	_parsePromise() {
		this.pos++; // <
		const elem = this.parseType();
		this.skip();
		while (!this.eof() && this.ch() !== ">") this.pos++;
		this.consume(">");
		return { kind: "promise", elem };
	}

	_parseBaseType(inReturn = false) {
		this.skip();
		const c = this.ch();
		if (c === "[") {
			return this._parseTupleType(inReturn);
		}
		if (c === "{") {
			this.skipBlock();
			return ANY;
		}
		if (c === "(") return this._parseParenType();
		if (c === '"' || c === "'") {
			this.skipStringLit();
			return { kind: "basic", name: "string" };
		}
		if (c === "`") return this._parseTemplateLit();
		if (/[0-9]/.test(c) || (c === "-" && /[0-9]/.test(this.src[this.pos + 1])))
			return this._parseNumericLit();
		const name = this.readIdent();
		if (!name) {
			this.pos++;
			return ANY;
		}
		return this._parseNamedType(name);
	}

	// ── Parameter list ───────────────────────────────────────────

	parseParams() {
		this.consume("(");
		const params = [];
		while (!this.eof() && this.peek() !== ")") {
			this.skip();
			if (this.ch() === ")") break;

			// rest param: ...name
			const isRest = this.startsWith("...");
			if (isRest) this.pos += 3;

			// param name (may be followed by ? for optional)
			const name = this.readIdent() || "_";
			this.skip();
			const optional = this.consume("?");

			// Type annotation
			let type = ANY;
			this.skip();
			if (this.ch() === ":") {
				this.pos++;
				type = this.parseType();
			}

			params.push({ name, type, variadic: isRest, optional });

			this.skip();
			if (this.ch() !== ",") break;
			this.pos++;
		}
		this.consume(")");
		return params;
	}

	// ── Body parsing ─────────────────────────────────────────────

	// Parse the interior of a namespace/class/interface/module block.
	// Returns a plain object: { memberName: GoFrontType }
	// `kinds` (a namespace body) receives the members that name a type or a
	// nested namespace; values and functions stay JavaScript properties.
	parseBody(kinds = null) {
		const members = {};
		while (!this.eof() && this.peek() !== "}") {
			this._parseMember(members, kinds);
		}
		return members;
	}

	_skipEnumBody() {
		this.skip();
		this.consume("{");
		while (!this.eof() && this.ch() !== "}") {
			this.readIdent();
			this.skip();
			if (this.ch() === "=") {
				this.pos++;
				this.skipTypeExpr(",}");
			}
			this.consume(",");
		}
		this.consume("}");
	}

	_skipModifiers() {
		while (true) {
			this.skip();
			let found = false;
			for (const mod of SKIP_MODIFIERS) {
				if (this.matchKw(mod)) {
					found = true;
					break;
				}
			}
			if (!found) break;
		}
	}

	_parseFuncDecl() {
		const name = this.readIdent();
		this.skipGenerics();
		const params = this.parseParams();
		this.skip();
		let ret = VOID;
		if (this.ch() === ":") {
			this.pos++;
			ret = this.parseType(true);
		}
		this.consume(";");
		return { name, val: funcType(params, ret) };
	}

	_parseMemberNewSig() {
		this.skipGenerics();
		this.parseParams();
		this.skip();
		if (this.ch() === ":") {
			this.pos++;
			this.parseType();
		}
		this.consume(";");
	}

	_parseTypeDecl() {
		const name = this.readIdent();
		this.skipGenerics();
		this.skip();
		let type = ANY;
		if (this.ch() === "=") {
			this.pos++;
			type = this.parseType();
		}
		this.consume(";");
		return { name, type };
	}

	// `A`, `a.B` or `A<T>`: a heritage clause entry, as its dotted name.
	_readHeritageName() {
		let name = this.readIdent();
		while (this.ch() === ".") {
			this.pos++;
			name += `.${this.readIdent()}`;
		}
		this.skipGenerics();
		return name;
	}

	// `extends A, B` of an interface or class (`implements` is not inherited
	// from); returns the names the declaration extends.
	_parseExtends() {
		const bases = [];
		if (this.matchKw("extends")) {
			do {
				this.skip();
				const base = this._readHeritageName();
				if (base) bases.push(base);
				this.skip();
			} while (this.consume(","));
		}
		return bases;
	}

	// An interface or class: a namespace-kind type tagged `_dtsType` so it is
	// told from a `declare namespace` (a value-only package) and from a
	// GoFront package. `extends` lists the names it inherits members from.
	// A declaration directly after a `@dictionary` comment is a dictionary
	// (`dictionary` true, tagged `_dictionary`): a parameter of that type
	// takes `nil`, a `map[string]any` literal whose constant keys are members
	// and a struct whose fields are members, as a JavaScript options object.
	_parseClassDecl(dictionary = false) {
		const name = this.readIdent();
		this.skipGenerics();
		this.skip();
		const bases = this._parseExtends();
		while (!this.eof() && this.ch() !== "{") this.pos++;
		this.consume("{");
		const body = this.parseBody();
		this.consume("}");
		this.consume(";");
		const ns = { kind: "namespace", name, members: body, _dtsType: true };
		if (dictionary) ns._dictionary = true;
		if (bases.length > 0) ns.extends = bases;
		return { name, ns };
	}

	_parseNamespaceDecl() {
		const name = this.readIdent() || this._readStringLit();
		this.skip();
		this.consume("{");
		const kinds = new Map();
		const body = this.parseBody(kinds);
		this.consume("}");
		this.consume(";");
		linkBases(Object.values(body), (n) => body[n]);
		return {
			name,
			ns: { kind: "namespace", name, members: body, _kinds: kinds },
		};
	}

	_parseVarDecl() {
		const name = this.readIdent();
		this.skip();
		this.consume("?");
		let type = ANY;
		if (this.ch() === ":") {
			this.pos++;
			type = this.parseType();
		}
		this.skip();
		if (this.ch() === "=") {
			this.pos++;
			this.skipTypeExpr();
		}
		this.consume(";");
		return { name, type };
	}

	// Stores a member that names a type or a nested namespace and, in a
	// namespace body, records which of the two it is.
	_setTypeMember(out, kinds, name, type, kind) {
		if (!name) return;
		out[name] = type;
		kinds?.set(name, kind);
	}

	_parseMember(out, kinds = null) {
		this.skip();
		if (this.eof() || this.ch() === "}") return;
		const dictionary = this._followsDictMark(this.pos);
		this._skipModifiers();
		this.skip();
		if (this.eof() || this.ch() === "}") return;
		const kw = this.readIdent();
		if (!kw) {
			this.pos++;
			return;
		}
		this.skip();
		switch (kw) {
			case "function": {
				const { name, val } = this._parseFuncDecl();
				if (name) out[name] = val;
				break;
			}
			case "new":
				this._parseMemberNewSig();
				break;
			case "type": {
				const { name, type } = this._parseTypeDecl();
				this._setTypeMember(out, kinds, name, type, "type");
				break;
			}
			case "interface":
			case "class": {
				const { name, ns } = this._parseClassDecl(dictionary);
				this._setTypeMember(out, kinds, name, ns, "type");
				break;
			}
			case "namespace":
			case "module": {
				const { name, ns } = this._parseNamespaceDecl();
				this._setTypeMember(out, kinds, name, ns, "pkg");
				break;
			}
			case "enum": {
				const name = this.readIdent();
				this._skipEnumBody();
				if (name) out[name] = ANY;
				break;
			}
			case "const":
			case "let":
			case "var": {
				const { name, type } = this._parseVarDecl();
				if (name) out[name] = type;
				break;
			}
			default:
				this._parseMemberDefault(kw, out);
				break;
		}
	}

	_parseMemberDefault(name, out) {
		this.skip();
		this.consume("?"); // optional property
		this.skipGenerics();
		this.skip();

		if (this.ch() === "(") {
			// Method signature
			const params = this.parseParams();
			this.skip();
			let ret = VOID;
			if (this.ch() === ":") {
				this.pos++;
				ret = this.parseType(true);
			}
			this.consume(";");
			out[name] = funcType(params, ret);
		} else if (this.ch() === ":") {
			this.pos++;
			const type = this.parseType();
			this.consume(";");
			out[name] = type;
		} else {
			// Unknown — skip to next ;
			this.skipTypeExpr();
			this.consume(";");
		}
	}

	_readStringLit() {
		this.skip();
		const c = this.ch();
		if (c !== '"' && c !== "'") return null;
		this.pos++;
		const start = this.pos;
		while (!this.eof() && this.ch() !== c) this.pos++;
		const s = this.src.slice(start, this.pos);
		this.pos++;
		return s;
	}

	// ── Top-level parse ──────────────────────────────────────────

	_parseDeclareModuleWrapper() {
		if (this.matchKw("declare") && this.matchKw("module")) {
			this._readStringLit() || this.readIdent();
			this.skip();
			this.consume("{");
		}
	}

	parse() {
		const types = new Map();
		const values = new Map();

		this.skip();
		this._parseDeclareModuleWrapper();

		while (!this.eof() && this.peek() !== "}") {
			this.skip();
			if (this.eof() || this.ch() === "}") break;

			const dictionary = this._followsDictMark(this.pos);
			this._skipModifiers();

			this.skip();
			if (this.eof() || this.ch() === "}") break;

			const kw = this.readIdent();
			if (!kw) {
				this.pos++;
				continue;
			}

			this.skip();
			const savedPos = this.pos;
			try {
				this._parseTopLevelDecl(kw, types, values, dictionary);
			} catch (err) {
				this.pos = savedPos;
				// skip to next top-level boundary (;, }, or EOF) to resume parsing
				while (!this.eof() && this.ch() !== ";" && this.ch() !== "}")
					this.pos++;
				this.consume(";");
				console.warn(
					`[dts-parser] skipping malformed declaration '${kw}': ${err.message}`,
				);
			}
		}

		linkBases(types.values(), (n) => types.get(n));
		return { types, values };
	}

	_parseTopLevelDecl(kw, types, values, dictionary = false) {
		switch (kw) {
			case "import":
			case "export":
				this.skipTypeExpr();
				this.consume(";");
				break;
			case "type": {
				const { name, type } = this._parseTypeDecl();
				if (name) types.set(name, type);
				break;
			}
			case "interface":
			case "class": {
				const { name, ns } = this._parseClassDecl(dictionary);
				if (name) {
					types.set(name, ns);
					if (kw === "class") values.set(name, ns);
				}
				break;
			}
			case "namespace":
			case "module": {
				const { name, ns } = this._parseNamespaceDecl();
				if (name) {
					types.set(name, ns);
					values.set(name, ns);
				}
				break;
			}
			case "enum": {
				const name = this.readIdent();
				this.skipBlock();
				this.consume(";");
				if (name) {
					types.set(name, ANY);
					values.set(name, ANY);
				}
				break;
			}
			case "function": {
				const { name, val } = this._parseFuncDecl();
				if (name) values.set(name, val);
				break;
			}
			case "const":
			case "let":
			case "var": {
				const { name, type } = this._parseVarDecl();
				if (name) values.set(name, type);
				break;
			}
			default:
				this.skipTypeExpr();
				this.consume(";");
				break;
		}
	}
}

// The `func` type of a signature with parameters `params` (parseParams) and
// result `ret`. A call must pass the arguments before the first optional
// parameter.
function funcType(params, ret) {
	const isVariadic = params.some((p) => p.variadic);
	const firstOptional = params.findIndex((p) => p.optional);
	return {
		kind: "func",
		params: params.map((p) =>
			p.variadic && p.type?.kind === "slice" ? p.type.elem : p.type,
		),
		returns:
			ret.kind === "tuple"
				? ret.types.length > 0
					? ret.types
					: [VOID]
				: [ret],
		...(isVariadic ? { variadic: true } : {}),
		...(firstOptional >= 0 ? { minArgs: firstOptional } : {}),
	};
}

// The type of the union `members`: its first member that is not `null` or
// `undefined`, marked `_nullable` when the union has one of those. `any` and
// a union of only `null` and `undefined` need no mark (they hold `nil`).
function nullableUnion(members) {
	const concrete = members.filter(
		(t) => !(t.kind === "basic" && t.name === "nil"),
	);
	if (concrete.length === members.length || concrete.length === 0)
		return members[0];
	const t = concrete[0];
	return t.kind === "basic" && t.name === "any" ? t : { ...t, _nullable: true };
}

// Binds the `extends` names of the interfaces and classes in `decls` that
// `lookup` finds in the same file or namespace as `_bases[i]`; a base declared
// elsewhere stays null and is found by name when its members are read.
function linkBases(decls, lookup) {
	for (const d of decls) {
		if (!d?._dtsType || !d.extends) continue;
		d._bases = d.extends.map((n) => {
			const b = lookup(n);
			return b?._dtsType ? b : null;
		});
	}
}

// Helper: parse a .d.ts file and return { types, values } Maps
export function parseDts(source) {
	const parser = new DtsParser(source);
	return parser.parse();
}

// Qualifies the references of `type` that name a type declared by the package
// (`names`) as `pkg.Name`, in place: its members, parameters, results and
// element types, and the `extends` names of a declaration. A name written
// qualified already names another package and is left alone.
function qualifyReferences(type, pkg, names, seen) {
	if (!type || typeof type !== "object" || seen.has(type)) return;
	seen.add(type);
	const walk = (t) => qualifyReferences(t, pkg, names, seen);
	switch (type.kind) {
		case "basic":
			if (type.alias && names.has(type.alias))
				type.alias = `${pkg}.${type.alias}`;
			break;
		case "namespace":
			for (const m of Object.values(type.members)) walk(m);
			if (type.extends)
				type.extends = type.extends.map((n) =>
					names.has(n) ? `${pkg}.${n}` : n,
				);
			break;
		case "func":
			type.params.forEach(walk);
			type.returns.forEach(walk);
			break;
		case "slice":
		case "promise":
			walk(type.elem);
			break;
		case "tuple":
			type.types.forEach(walk);
			break;
	}
}

// The packages a declaration file lists in its `/// <reference
// types="gofront/x" />` header comments.
function referencedPackages(source) {
	return [
		...source.matchAll(/^\/\/\/\s*<reference\s+types="gofront\/([a-z0-9]+)"/gm),
	].map((m) => m[1]);
}

// Parses the declaration file of the package `name` (`gofront/<name>`):
// `{ name, types, values, requires }`, where `requires` names the packages
// its header comments reference. Its own type references are qualified (see
// above), so the result is bound under `name.` in a checker's type table.
export function parseDeclarationPackage(source, name) {
	const { types, values } = parseDts(source);
	const names = new Set(types.keys());
	const seen = new Set();
	for (const t of types.values()) {
		if (t._dtsType) t._pkg = name;
		qualifyReferences(t, name, names, seen);
	}
	for (const t of values.values()) qualifyReferences(t, name, names, seen);
	return { name, types, values, requires: referencedPackages(source) };
}
