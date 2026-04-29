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

const THREE_CHAR_OPS = new Set(["===", "!==", "...", ">>>", "**="]);
const TWO_CHAR_OPS = new Set([
	"==",
	"!=",
	"<=",
	">=",
	"&&",
	"||",
	"++",
	"--",
	"+=",
	"-=",
	"*=",
	"/=",
	"=>",
	"**",
	"??",
	"?.",
	">>",
	"<<",
]);
// Tokens/values after which a `/` starts a regex rather than a division
const REGEX_CONTEXT_VALUES = new Set([
	"(",
	"[",
	",",
	";",
	"!",
	"=",
	"==",
	"===",
	"!=",
	"!==",
	":",
	"return",
	"case",
	"typeof",
	"{",
	"&&",
	"||",
]);

function _isRegexContext(tokens) {
	const prev = lastNonWhitespaceToken(tokens);
	if (!prev) return true;
	return prev.type === "op" || REGEX_CONTEXT_VALUES.has(prev.value);
}

function _scanRegexLiteral(code, i, len) {
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
	return j;
}

function _scanStringLiteral(code, i, len, quote) {
	let j = i + 1;
	while (j < len) {
		if (code[j] === "\\" && j + 1 < len) {
			j += 2;
		} else if (code[j] === quote) {
			j++;
			break;
		} else {
			j++;
		}
	}
	return j;
}

function _scanTemplateLiteral(code, i, len) {
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
			else if (code[j] === "}") braceDepth--;
		}
		j++;
	}
	return j;
}

function _scanDecimalNumber(code, j, len) {
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
	return j;
}

function _scanNumber(code, i, len) {
	const ch = code[i];
	let j = i + 1;
	if (ch === "0" && j < len && (code[j] === "x" || code[j] === "X")) {
		j++;
		while (j < len && /[0-9a-fA-F]/.test(code[j])) j++;
	} else {
		j = _scanDecimalNumber(code, j, len);
	}
	return j;
}

function _scanWhitespace(code, i, len) {
	let j = i + 1;
	while (j < len && /\s/.test(code[j])) j++;
	return j;
}

function _scanIdent(code, i, len) {
	let j = i + 1;
	while (j < len && /[a-zA-Z0-9_$]/.test(code[j])) j++;
	return j;
}

function _isNumberStart(ch, code, i, len) {
	return (
		/[0-9]/.test(ch) || (ch === "." && i + 1 < len && /[0-9]/.test(code[i + 1]))
	);
}

function tokenize(code) {
	const tokens = [];
	let i = 0;
	const len = code.length;

	while (i < len) {
		const ch = code[i];

		if (ch === "/" && code[i + 1] === "/") {
			let end = code.indexOf("\n", i);
			if (end === -1) end = len;
			tokens.push({ type: "comment", value: code.slice(i, end) });
			i = end;
			continue;
		}
		if (ch === "/" && code[i + 1] === "*") {
			const end = code.indexOf("*/", i + 2);
			const closeAt = end === -1 ? len : end + 2;
			tokens.push({ type: "comment", value: code.slice(i, closeAt) });
			i = closeAt;
			continue;
		}
		if (ch === "/" && _isRegexContext(tokens)) {
			const j = _scanRegexLiteral(code, i, len);
			tokens.push({ type: "regex", value: code.slice(i, j) });
			i = j;
			continue;
		}
		if (ch === '"' || ch === "'") {
			const j = _scanStringLiteral(code, i, len, ch);
			tokens.push({ type: "string", value: code.slice(i, j) });
			i = j;
			continue;
		}
		if (ch === "`") {
			const j = _scanTemplateLiteral(code, i, len);
			tokens.push({ type: "template", value: code.slice(i, j) });
			i = j;
			continue;
		}
		if (/\s/.test(ch)) {
			const j = _scanWhitespace(code, i, len);
			tokens.push({ type: "ws", value: code.slice(i, j) });
			i = j;
			continue;
		}
		if (/[a-zA-Z_$]/.test(ch)) {
			const j = _scanIdent(code, i, len);
			const word = code.slice(i, j);
			tokens.push({
				type: JS_KEYWORDS.has(word) ? "kw" : "ident",
				value: word,
			});
			i = j;
			continue;
		}
		if (_isNumberStart(ch, code, i, len)) {
			const j = _scanNumber(code, i, len);
			tokens.push({ type: "num", value: code.slice(i, j) });
			i = j;
			continue;
		}
		const three = code.slice(i, i + 3);
		if (THREE_CHAR_OPS.has(three)) {
			tokens.push({ type: "op", value: three });
			i += 3;
			continue;
		}
		const two = code.slice(i, i + 2);
		if (TWO_CHAR_OPS.has(two)) {
			tokens.push({ type: "op", value: two });
			i += 2;
			continue;
		}
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

// Token types that always need a space after a keyword
const SPACE_AFTER_KW_RIGHT_TYPES = new Set([
	"ident",
	"kw",
	"num",
	"string",
	"template",
	"regex",
]);
// Operator values that do NOT need a space after a keyword
const NO_SPACE_AFTER_KW_OPS = new Set(["(", "[", "!", "-", "+"]);
// Adjacent op pairs that would accidentally merge into a different operator
const _INCREMENT_MERGE_PAIRS = new Set([
	"+|+",
	"-|-",
	"+|++",
	"-|--",
	"++|+",
	"--|−-",
]);

function _wouldMergeUnaryOps(left, right) {
	return (
		(left.value === "+" && right.value === "+") ||
		(left.value === "-" && right.value === "-") ||
		(left.value === "+" && right.value === "++") ||
		(left.value === "-" && right.value === "--") ||
		(left.value === "++" && right.value === "+") ||
		(left.value === "--" && right.value === "-")
	);
}

function needsSpaceBetween(left, right) {
	// Keywords that need space after when followed by ident/num/string/keyword
	if (left.type === "kw" && SPACE_AFTER_KW.has(left.value)) {
		if (SPACE_AFTER_KW_RIGHT_TYPES.has(right.type)) return true;
		if (right.type === "op" && NO_SPACE_AFTER_KW_OPS.has(right.value))
			return false;
	}

	// Two adjacent ident-like tokens need a space
	if (isIdentLike(left.type) && isIdentLike(right.type)) return true;

	// Prevent ++ or -- from merging with adjacent + or -
	if (_wouldMergeUnaryOps(left, right)) return true;

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

function _collectProtectedIdent(tok, tokens, i, protectedNames) {
	if (tok.value === "class" || tok.value === "extends" || tok.value === ".") {
		const next = nextNonWs(tokens, i);
		if (next && next.tok.type === "ident") protectedNames.add(next.tok.value);
	}
}

function _collectVarLocalDecls(tokens, i, declaredLocals) {
	const next = nextNonWs(tokens, i);
	if (next && next.tok.type === "ident") declaredLocals.add(next.tok.value);
	if (next && (next.tok.value === "[" || next.tok.value === "{"))
		collectDestructured(tokens, next.idx, declaredLocals);
}

function _collectParamDecls(tokens, i, declaredLocals) {
	const prev = findPrevNonWsToken(tokens, i);
	if (
		prev &&
		(prev.value === "function" || prev.type === "ident" || prev.value === ")")
	)
		collectParams(tokens, i, declaredLocals);
}

function _collectLocalDecls(tokens) {
	const declaredLocals = new Set();
	const protectedNames = new Set();

	for (let i = 0; i < tokens.length; i++) {
		const tok = tokens[i];
		if (tok.type !== "kw" && tok.type !== "op") continue;

		_collectProtectedIdent(tok, tokens, i, protectedNames);

		if (tok.value === "let" || tok.value === "const" || tok.value === "var")
			_collectVarLocalDecls(tokens, i, declaredLocals);

		if (tok.value === "(") _collectParamDecls(tokens, i, declaredLocals);
	}

	for (const name of protectedNames) declaredLocals.delete(name);
	return { declaredLocals };
}

const MANGLE_GLOBALS = new Set([
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

function _filterRenameCandidates(declaredLocals) {
	for (const name of MANGLE_GLOBALS) declaredLocals.delete(name);
	for (const name of declaredLocals) {
		if (name.startsWith("__") || name.length <= 1) declaredLocals.delete(name);
	}
}

function _applyRenaming(tokens, renameMap) {
	let out = "";
	for (let i = 0; i < tokens.length; i++) {
		const tok = tokens[i];
		if (tok.type === "ident" && renameMap.has(tok.value)) {
			const prev = findPrevNonWsToken(tokens, i);
			out += prev && prev.value === "." ? tok.value : renameMap.get(tok.value);
		} else {
			out += tok.value;
		}
	}
	return out;
}

function mangle(code) {
	const tokens = tokenize(code);
	const nameGen = shortNameGeneratorFn();
	const renameMap = new Map();
	const { declaredLocals } = _collectLocalDecls(tokens);
	_filterRenameCandidates(declaredLocals);
	for (const name of declaredLocals) renameMap.set(name, nameGen());
	return _applyRenaming(tokens, renameMap);
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

function _isParamStart(tokens, i) {
	const prev = findPrevNonWsToken(tokens, i);
	return (
		!prev ||
		prev.value === "(" ||
		prev.value === "," ||
		prev.value === "[" ||
		prev.value === "{"
	);
}

function collectParams(tokens, openIdx, locals) {
	let depth = 1;
	for (let i = openIdx + 1; i < tokens.length && depth > 0; i++) {
		const t = tokens[i];
		if (t.value === "(") depth++;
		else if (t.value === ")") depth--;
		else if (depth === 1 && t.type === "ident" && _isParamStart(tokens, i))
			locals.add(t.value);
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
