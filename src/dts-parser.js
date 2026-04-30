// Parses TypeScript .d.ts declaration files into GoFront's type system.
//
// Produces:
//   { types: Map<name, GoFrontType>, values: Map<name, GoFrontType> }
//
// Types / values are kept separate because TypeScript allows a name to be
// both a type alias (e.g. `export type mat4 = ...`) and a namespace
// (e.g. `export namespace mat4 { function create(): mat4 }`).
//
// Complex TypeScript types (generics, unions, intersections, mapped types,
// conditional types, etc.) are simplified to `any`.

const ANY = { kind: "basic", name: "any" };
const VOID = { kind: "basic", name: "void" };

const TS_PRIMITIVES = {
	number: { kind: "basic", name: "float64" },
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
		while (!this.eof() && this.ch() !== "\n") this.pos++;
	}

	_skipBlockComment() {
		this.pos += 2;
		while (!this.eof() && !(this.ch() === "*" && this.ch1() === "/"))
			this.pos++;
		if (!this.eof()) this.pos += 2;
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
		let s = "";
		while (!this.eof() && /[a-zA-Z0-9_$]/.test(this.ch()))
			s += this.src[this.pos++];
		return s;
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
		const open = { "<": 0, "(": 1, "[": 2, "{": 3 };
		const close = { ">": 0, ")": 1, "]": 2, "}": 3 };
		if (c in open) {
			depths[open[c]]++;
			return true;
		}
		if (c in close && depths[close[c]] > 0) {
			depths[close[c]]--;
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

	// Parse a TypeScript type expression and return a GoFront type.
	// Always returns something; falls back to ANY for complex types.
	parseType() {
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

		let base = this._parseBaseType();

		this.skip();
		// Array suffix: T[] or T[][]
		while (this.startsWith("[]")) {
			this.pos += 2;
			base = { kind: "slice", elem: base };
			this.skip();
		}

		// Union / intersection: T | U  or  T & U → simplify to first concrete type
		// (skip() handles multi-line unions where | is on the next line)
		this.skip();
		while (!this.eof() && (this.ch() === "|" || this.ch() === "&")) {
			this.pos++;
			this.parseType(); // discard (already calls skip() at start)
		}

		return base;
	}

	_parseParenType() {
		this.pos++;
		this.skipTypeExpr(")");
		this.consume(")");
		this.skip();
		if (this.startsWith("=>")) {
			this.pos += 2;
			this.parseType();
		}
		return ANY;
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
		this.skipGenerics();
		while (this.ch() === ".") {
			this.pos++;
			this.readIdent();
		}
		return { kind: "basic", name: "any", alias: name };
	}

	_parseBaseType() {
		this.skip();
		const c = this.ch();
		if (c === "[") {
			this.pos++;
			this.skipTypeExpr("]");
			this.consume("]");
			return ANY;
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
			this.consume("?"); // optional marker

			// Type annotation
			let type = ANY;
			this.skip();
			if (this.ch() === ":") {
				this.pos++;
				type = this.parseType();
			}

			params.push({ name, type, variadic: isRest });

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
	parseBody() {
		const members = {};
		while (!this.eof() && this.peek() !== "}") {
			this._parseMember(members);
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

	_parseMemberFuncDecl(out) {
		const name = this.readIdent();
		this.skipGenerics();
		const params = this.parseParams();
		this.skip();
		let ret = VOID;
		if (this.ch() === ":") {
			this.pos++;
			ret = this.parseType();
		}
		this.consume(";");
		if (name)
			out[name] = {
				kind: "func",
				params: params.map((p) => p.type),
				returns: [ret],
			};
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

	_parseMemberTypeDecl(out) {
		const name = this.readIdent();
		this.skipGenerics();
		this.skip();
		let type = ANY;
		if (this.ch() === "=") {
			this.pos++;
			type = this.parseType();
		}
		this.consume(";");
		if (name) out[name] = type;
	}

	_parseMemberClassDecl(out) {
		const name = this.readIdent();
		this.skipGenerics();
		while (!this.eof() && this.ch() !== "{") this.pos++;
		this.consume("{");
		const body = this.parseBody();
		this.consume("}");
		this.consume(";");
		if (name) out[name] = { kind: "namespace", name, members: body };
	}

	_parseMemberVarDecl(out) {
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
		if (name) out[name] = type;
	}

	_parseMember(out) {
		this.skip();
		if (this.eof() || this.ch() === "}") return;
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
			case "function":
				this._parseMemberFuncDecl(out);
				break;
			case "new":
				this._parseMemberNewSig();
				break;
			case "type":
				this._parseMemberTypeDecl(out);
				break;
			case "interface":
			case "class":
				this._parseMemberClassDecl(out);
				break;
			case "namespace":
			case "module": {
				const name = this.readIdent() || this._readStringLit();
				this.skip();
				this.consume("{");
				const body = this.parseBody();
				this.consume("}");
				this.consume(";");
				if (name) out[name] = { kind: "namespace", name, members: body };
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
			case "var":
				this._parseMemberVarDecl(out);
				break;
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
				ret = this.parseType();
			}
			this.consume(";");
			out[name] = {
				kind: "func",
				params: params.map((p) => p.type),
				returns: [ret],
			};
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
		let s = "";
		while (!this.eof() && this.ch() !== c) s += this.src[this.pos++];
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
				this._parseTopLevelDecl(kw, types, values);
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

		return { types, values };
	}

	_parseTopLevelTypeAlias(types) {
		const name = this.readIdent();
		this.skipGenerics();
		this.skip();
		let type = ANY;
		if (this.ch() === "=") {
			this.pos++;
			type = this.parseType();
		}
		this.consume(";");
		if (name) types.set(name, type);
	}

	_parseTopLevelClassDecl(kw, types, values) {
		const name = this.readIdent();
		this.skipGenerics();
		while (!this.eof() && this.ch() !== "{") this.pos++;
		this.consume("{");
		const body = this.parseBody();
		this.consume("}");
		this.consume(";");
		if (name) {
			const ns = { kind: "namespace", name, members: body };
			types.set(name, ns);
			if (kw === "class") values.set(name, ns);
		}
	}

	_parseTopLevelNamespaceDecl(types, values) {
		const name = this.readIdent() || this._readStringLit();
		this.skip();
		this.consume("{");
		const body = this.parseBody();
		this.consume("}");
		this.consume(";");
		if (name) {
			const ns = { kind: "namespace", name, members: body };
			types.set(name, ns);
			values.set(name, ns);
		}
	}

	_parseTopLevelFuncDecl(values) {
		const name = this.readIdent();
		this.skipGenerics();
		const params = this.parseParams();
		this.skip();
		let ret = VOID;
		if (this.ch() === ":") {
			this.pos++;
			ret = this.parseType();
		}
		this.consume(";");
		if (name)
			values.set(name, {
				kind: "func",
				params: params.map((p) => p.type),
				returns: [ret],
			});
	}

	_parseTopLevelVarDecl(values) {
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
		if (name) values.set(name, type);
	}

	_parseTopLevelDecl(kw, types, values) {
		switch (kw) {
			case "import":
			case "export":
				this.skipTypeExpr();
				this.consume(";");
				break;
			case "type":
				this._parseTopLevelTypeAlias(types);
				break;
			case "interface":
			case "class":
				this._parseTopLevelClassDecl(kw, types, values);
				break;
			case "namespace":
			case "module":
				this._parseTopLevelNamespaceDecl(types, values);
				break;
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
			case "function":
				this._parseTopLevelFuncDecl(values);
				break;
			case "const":
			case "let":
			case "var":
				this._parseTopLevelVarDecl(values);
				break;
			default:
				this.skipTypeExpr();
				this.consume(";");
				break;
		}
	}
}

// Helper: parse a .d.ts file and return { types, values } Maps
export function parseDts(source) {
	const parser = new DtsParser(source);
	return parser.parse();
}
