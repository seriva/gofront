// GoFront built-in minifier
// Operates on JS string output (post-CodeGen), no AST needed.

const JS_KEYWORDS = new Set([
	"break",
	"case",
	"catch",
	"class",
	"const",
	"continue",
	"debugger",
	"default",
	"delete",
	"do",
	"else",
	"enum",
	"export",
	"extends",
	"false",
	"finally",
	"for",
	"function",
	"if",
	"import",
	"in",
	"instanceof",
	"let",
	"new",
	"null",
	"of",
	"return",
	"super",
	"switch",
	"this",
	"throw",
	"true",
	"try",
	"typeof",
	"var",
	"void",
	"while",
	"with",
	"yield",
	"async",
	"await",
	"static",
]);

// Keywords that must keep a space after them when followed by an identifier/literal
const SPACE_AFTER_KW = new Set([
	"return",
	"let",
	"const",
	"var",
	"typeof",
	"new",
	"case",
	"throw",
	"void",
	"delete",
	"in",
	"of",
	"instanceof",
	"function",
	"class",
	"extends",
	"import",
	"export",
	"async",
	"await",
	"yield",
	"static",
]);

// ── Tokenizer ────────────────────────────────────────────────
// Splits JS source into tokens preserving strings, template literals, and regexes.

function tokenize(code) {
	const tokens = [];
	let i = 0;
	const len = code.length;

	while (i < len) {
		const ch = code[i];

		// Line comment
		if (ch === "/" && code[i + 1] === "/") {
			let end = code.indexOf("\n", i);
			if (end === -1) end = len;
			tokens.push({ type: "comment", value: code.slice(i, end) });
			i = end;
			continue;
		}

		// Block comment
		if (ch === "/" && code[i + 1] === "*") {
			const end = code.indexOf("*/", i + 2);
			const closeAt = end === -1 ? len : end + 2;
			tokens.push({ type: "comment", value: code.slice(i, closeAt) });
			i = closeAt;
			continue;
		}

		// Regex literal — only after certain tokens
		if (ch === "/") {
			const prev = lastNonWhitespaceToken(tokens);
			const prevVal = prev?.value;
			const isRegexContext =
				!prev ||
				prev.type === "op" ||
				prevVal === "(" ||
				prevVal === "[" ||
				prevVal === "," ||
				prevVal === ";" ||
				prevVal === "!" ||
				prevVal === "=" ||
				prevVal === "==" ||
				prevVal === "===" ||
				prevVal === "!=" ||
				prevVal === "!==" ||
				prevVal === ":" ||
				prevVal === "return" ||
				prevVal === "case" ||
				prevVal === "typeof" ||
				prevVal === "{" ||
				prevVal === "&&" ||
				prevVal === "||";
			if (isRegexContext) {
				let j = i + 1;
				let escaped = false;
				let inCharClass = false;
				while (j < len) {
					const rc = code[j];
					if (escaped) {
						escaped = false;
					} else if (rc === "\\") {
						escaped = true;
					} else if (rc === "[") {
						inCharClass = true;
					} else if (rc === "]") {
						inCharClass = false;
					} else if (rc === "/" && !inCharClass) {
						j++;
						break;
					}
					j++;
				}
				// consume flags
				while (j < len && /[gimsuy]/.test(code[j])) j++;
				tokens.push({ type: "regex", value: code.slice(i, j) });
				i = j;
				continue;
			}
		}

		// String literals (double or single quote)
		if (ch === '"' || ch === "'") {
			let j = i + 1;
			while (j < len) {
				if (code[j] === "\\" && j + 1 < len) {
					j += 2;
				} else if (code[j] === ch) {
					j++;
					break;
				} else {
					j++;
				}
			}
			tokens.push({ type: "string", value: code.slice(i, j) });
			i = j;
			continue;
		}

		// Template literal
		if (ch === "`") {
			let j = i + 1;
			let depth = 1;
			let braceDepth = 0;
			while (j < len && depth > 0) {
				if (code[j] === "\\" && j + 1 < len) {
					j += 2;
					continue;
				}
				if (braceDepth === 0 && code[j] === "`") {
					depth--;
					j++;
					continue;
				}
				if (code[j] === "$" && code[j + 1] === "{" && braceDepth === 0) {
					braceDepth = 1;
					j += 2;
					continue;
				}
				if (braceDepth > 0) {
					if (code[j] === "{") braceDepth++;
					else if (code[j] === "}") {
						braceDepth--;
					}
				}
				j++;
			}
			tokens.push({ type: "template", value: code.slice(i, j) });
			i = j;
			continue;
		}

		// Whitespace
		if (/\s/.test(ch)) {
			let j = i + 1;
			while (j < len && /\s/.test(code[j])) j++;
			tokens.push({ type: "ws", value: code.slice(i, j) });
			i = j;
			continue;
		}

		// Identifier or keyword
		if (/[a-zA-Z_$]/.test(ch)) {
			let j = i + 1;
			while (j < len && /[a-zA-Z0-9_$]/.test(code[j])) j++;
			const word = code.slice(i, j);
			tokens.push({
				type: JS_KEYWORDS.has(word) ? "kw" : "ident",
				value: word,
			});
			i = j;
			continue;
		}

		// Number
		if (
			/[0-9]/.test(ch) ||
			(ch === "." && i + 1 < len && /[0-9]/.test(code[i + 1]))
		) {
			let j = i + 1;
			// hex
			if (ch === "0" && j < len && (code[j] === "x" || code[j] === "X")) {
				j++;
				while (j < len && /[0-9a-fA-F]/.test(code[j])) j++;
			} else {
				while (j < len && /[0-9]/.test(code[j])) j++;
				if (j < len && code[j] === ".") {
					j++;
					while (j < len && /[0-9]/.test(code[j])) j++;
				}
				if (j < len && (code[j] === "e" || code[j] === "E")) {
					j++;
					if (j < len && (code[j] === "+" || code[j] === "-")) j++;
					while (j < len && /[0-9]/.test(code[j])) j++;
				}
			}
			tokens.push({ type: "num", value: code.slice(i, j) });
			i = j;
			continue;
		}

		// Multi-char operators
		const two = code.slice(i, i + 2);
		const three = code.slice(i, i + 3);
		if (
			three === "===" ||
			three === "!==" ||
			three === "..." ||
			three === ">>>" ||
			three === "**="
		) {
			tokens.push({ type: "op", value: three });
			i += 3;
			continue;
		}
		if (
			two === "==" ||
			two === "!=" ||
			two === "<=" ||
			two === ">=" ||
			two === "&&" ||
			two === "||" ||
			two === "++" ||
			two === "--" ||
			two === "+=" ||
			two === "-=" ||
			two === "*=" ||
			two === "/=" ||
			two === "=>" ||
			two === "**" ||
			two === "??" ||
			two === "?." ||
			two === ">>" ||
			two === "<<"
		) {
			tokens.push({ type: "op", value: two });
			i += 2;
			continue;
		}

		// Single-char operator/punctuation
		tokens.push({ type: "op", value: ch });
		i += 1;
	}

	return tokens;
}

function lastNonWhitespaceToken(tokens) {
	for (let i = tokens.length - 1; i >= 0; i--) {
		if (tokens[i].type !== "ws" && tokens[i].type !== "comment")
			return tokens[i];
	}
	return null;
}

// ── Stage 1 & 2: Compress ────────────────────────────────────

function isIdentLike(type) {
	return type === "ident" || type === "kw" || type === "num";
}

function needsSpaceBetween(left, right) {
	// Keywords that need space after when followed by ident/num/string/keyword
	if (left.type === "kw" && SPACE_AFTER_KW.has(left.value)) {
		if (
			right.type === "ident" ||
			right.type === "kw" ||
			right.type === "num" ||
			right.type === "string" ||
			right.type === "template" ||
			right.type === "regex"
		) {
			return true;
		}
		// e.g., `return(` or `return!` — no space needed
		if (
			right.type === "op" &&
			(right.value === "(" ||
				right.value === "[" ||
				right.value === "!" ||
				right.value === "-" ||
				right.value === "+")
		) {
			// "return(" is fine, "delete(" is fine, "new(" is fine
			// But "function(" needs no space, "class{" needs no space... actually they do need space before name
			return false;
		}
	}

	// Two adjacent ident-like tokens need a space
	if (isIdentLike(left.type) && isIdentLike(right.type)) return true;

	// ident followed by string/template/regex needs space in some cases
	// but generally not for GoFront output

	// Prevent ++ or -- from merging with adjacent + or -
	if (
		(left.value === "+" && right.value === "+") ||
		(left.value === "-" && right.value === "-") ||
		(left.value === "+" && right.value === "++") ||
		(left.value === "-" && right.value === "--") ||
		(left.value === "++" && right.value === "+") ||
		(left.value === "--" && right.value === "-")
	) {
		return true;
	}

	return false;
}

function compress(code) {
	const tokens = tokenize(code);
	let out = "";

	for (let i = 0; i < tokens.length; i++) {
		const tok = tokens[i];

		// Stage 1: strip comments
		if (tok.type === "comment") continue;
		// Stage 1: strip whitespace (handled by needsSpaceBetween)
		if (tok.type === "ws") continue;

		// Preserve strings, templates, regexes verbatim
		if (
			tok.type === "string" ||
			tok.type === "template" ||
			tok.type === "regex"
		) {
			if (out.length > 0) {
				const lastChar = out[out.length - 1];
				// Need space if previous was ident-like
				if (/[a-zA-Z0-9_$]/.test(lastChar) && tok.type !== "regex") {
					// Check if preceding token is a keyword needing space
					const prevTok = findPrevNonWs(tokens, i);
					if (
						prevTok &&
						prevTok.type === "kw" &&
						SPACE_AFTER_KW.has(prevTok.value)
					) {
						out += " ";
					}
				}
			}
			out += tok.value;
			continue;
		}

		// For all other tokens, check if space is needed
		if (out.length > 0) {
			const prevTok = findPrevNonWs(tokens, i);
			if (prevTok && needsSpaceBetween(prevTok, tok)) {
				out += " ";
			}
		}

		out += tok.value;
	}

	return out;
}

function findPrevNonWs(tokens, index) {
	for (let i = index - 1; i >= 0; i--) {
		if (tokens[i].type !== "ws" && tokens[i].type !== "comment")
			return tokens[i];
	}
	return null;
}

// ── Stage 3: Identifier mangling ─────────────────────────────

function mangle(code) {
	const tokens = tokenize(code);

	// Collect local variable declarations and their scopes
	const nameGen = shortNameGeneratorFn();
	const renameMap = new Map();

	// Find all identifiers that are local declarations (let, const, var, function params)
	// and not class/method names or properties
	const declaredLocals = new Set();
	const protectedNames = new Set();

	for (let i = 0; i < tokens.length; i++) {
		const tok = tokens[i];
		if (tok.type !== "kw" && tok.type !== "op") continue;

		// class Name or extends Name — protect
		if (tok.value === "class" || tok.value === "extends") {
			const next = nextNonWs(tokens, i);
			if (next && next.tok.type === "ident") {
				protectedNames.add(next.tok.value);
			}
		}

		// Property access: .name — protect
		if (tok.value === ".") {
			const next = nextNonWs(tokens, i);
			if (next && next.tok.type === "ident") {
				protectedNames.add(next.tok.value);
			}
		}

		// Method definitions: name( in class body — protect
		// We approximate: ident followed by ( at class level

		// let/const/var name — local
		if (tok.value === "let" || tok.value === "const" || tok.value === "var") {
			const next = nextNonWs(tokens, i);
			if (next && next.tok.type === "ident") {
				declaredLocals.add(next.tok.value);
			}
			// Destructuring: let [a, b] or let {a, b}
			if (next && (next.tok.value === "[" || next.tok.value === "{")) {
				collectDestructured(tokens, next.idx, declaredLocals);
			}
		}

		// Function params
		if (tok.value === "(") {
			const prev = findPrevNonWsToken(tokens, i);
			if (
				prev &&
				(prev.value === "function" ||
					prev.type === "ident" ||
					prev.value === ")")
			) {
				collectParams(tokens, i, declaredLocals);
			}
		}

		// Arrow function params handled by ( above
	}

	// Remove protected names from locals
	for (const name of protectedNames) {
		declaredLocals.delete(name);
	}

	// Also protect known globals and short names
	const globals = new Set([
		"console",
		"document",
		"window",
		"Math",
		"JSON",
		"String",
		"Number",
		"Boolean",
		"Array",
		"Object",
		"Error",
		"Date",
		"RegExp",
		"Map",
		"Set",
		"Promise",
		"Symbol",
		"parseInt",
		"parseFloat",
		"isNaN",
		"isFinite",
		"undefined",
		"null",
		"NaN",
		"Infinity",
		"TextEncoder",
		"TextDecoder",
		"setTimeout",
		"setInterval",
		"clearTimeout",
		"clearInterval",
		"prototype",
		"constructor",
		"this",
		"super",
		"arguments",
	]);
	for (const name of globals) declaredLocals.delete(name);

	// Don't mangle __ prefixed helpers or single-char names
	for (const name of declaredLocals) {
		if (name.startsWith("__") || name.length <= 1) {
			declaredLocals.delete(name);
		}
	}

	// Assign short names
	for (const name of declaredLocals) {
		const short = nameGen();
		renameMap.set(name, short);
	}

	// Apply renaming
	let out = "";
	for (let i = 0; i < tokens.length; i++) {
		const tok = tokens[i];
		if (tok.type === "ident" && renameMap.has(tok.value)) {
			// Don't rename if preceded by dot (property access)
			const prev = findPrevNonWsToken(tokens, i);
			if (prev && prev.value === ".") {
				out += tok.value;
			} else {
				out += renameMap.get(tok.value);
			}
		} else {
			out += tok.value;
		}
	}

	return out;
}

function nextNonWs(tokens, index) {
	for (let i = index + 1; i < tokens.length; i++) {
		if (tokens[i].type !== "ws" && tokens[i].type !== "comment") {
			return { tok: tokens[i], idx: i };
		}
	}
	return null;
}

function findPrevNonWsToken(tokens, index) {
	for (let i = index - 1; i >= 0; i--) {
		if (tokens[i].type !== "ws" && tokens[i].type !== "comment")
			return tokens[i];
	}
	return null;
}

function collectDestructured(tokens, startIdx, locals) {
	const open = tokens[startIdx].value;
	const close = open === "[" ? "]" : "}";
	let depth = 1;
	for (let i = startIdx + 1; i < tokens.length && depth > 0; i++) {
		const t = tokens[i];
		if (t.value === open) depth++;
		else if (t.value === close) depth--;
		else if (depth === 1 && t.type === "ident") {
			locals.add(t.value);
		}
	}
}

function collectParams(tokens, openIdx, locals) {
	let depth = 1;
	for (let i = openIdx + 1; i < tokens.length && depth > 0; i++) {
		const t = tokens[i];
		if (t.value === "(") depth++;
		else if (t.value === ")") depth--;
		else if (depth === 1 && t.type === "ident") {
			// Check if not a default value expression
			const prev = findPrevNonWsToken(tokens, i);
			if (
				!prev ||
				prev.value === "(" ||
				prev.value === "," ||
				prev.value === "[" ||
				prev.value === "{"
			) {
				locals.add(t.value);
			}
		}
	}
}

function* shortNameGenerator() {
	const chars = "abcdefghijklmnopqrstuvwxyz";
	let index = 0;
	while (true) {
		if (index < 26) {
			yield chars[index++];
		} else {
			const base = index - 26;
			yield chars[base % 26] + (Math.floor(base / 26) + 1);
			index++;
		}
	}
}

// Make it callable (not an iterator interface)
function shortNameGeneratorFn() {
	const gen = shortNameGenerator();
	return () => gen.next().value;
}

// ── Stage 4: Literal folding ─────────────────────────────────

function foldLiterals(code) {
	// Fold patterns like: <number> <op> <number> where both are literal constants
	return code.replace(
		/\b(\d+(?:\.\d+)?)\s*(\+|-|\*|\/|%)\s*(\d+(?:\.\d+)?)\b/g,
		(match, left, op, right) => {
			const l = Number(left);
			const r = Number(right);
			let result;
			switch (op) {
				case "+":
					result = l + r;
					break;
				case "-":
					result = l - r;
					break;
				case "*":
					result = l * r;
					break;
				case "/":
					result = r !== 0 ? l / r : null;
					break;
				case "%":
					result = r !== 0 ? l % r : null;
					break;
				default:
					return match;
			}
			if (result === null || !Number.isFinite(result)) return match;
			// If result is integer, emit without decimal point
			const s = Number.isInteger(result) ? String(result) : String(result);
			return s;
		},
	);
}

// ── Public API ───────────────────────────────────────────────

export function minify(code, options = {}) {
	const { mangle: doMangle = false } = options;

	// Stage 1 + 2: compress (strips comments, whitespace, compresses tokens)
	let result = compress(code);

	// Stage 4: literal folding
	result = foldLiterals(result);

	// Stage 3: mangling (optional)
	if (doMangle) {
		result = mangle(result);
		// Re-compress after mangling to clean up any leftover whitespace
		result = compress(result);
	}

	return result;
}
