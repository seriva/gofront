// src/parser/struct-tag.js
// Parse Go struct field tags matching Go's reflect.StructTag specification.

function unquoteTagValue(s) {
	if (s.length < 2 || s[0] !== '"' || s[s.length - 1] !== '"') return s;
	const inner = s.slice(1, -1);
	let res = "";
	for (let i = 0; i < inner.length; i++) {
		if (inner[i] === "\\" && i + 1 < inner.length) {
			i++;
			const esc = inner[i];
			switch (esc) {
				case "n":
					res += "\n";
					break;
				case "t":
					res += "\t";
					break;
				case "r":
					res += "\r";
					break;
				case '"':
					res += '"';
					break;
				case "\\":
					res += "\\";
					break;
				case "a":
					res += "\x07";
					break;
				case "b":
					res += "\b";
					break;
				case "f":
					res += "\f";
					break;
				case "v":
					res += "\v";
					break;
				case "0":
					res += "\0";
					break;
				default:
					res += `\\${esc}`;
					break;
			}
		} else {
			res += inner[i];
		}
	}
	return res;
}

/**
 * Parses a raw struct tag string into a Map of key -> unquoted string value,
 * adhering to Go reflect.StructTag convention.
 *
 * @param {string | null | undefined} tag
 * @returns {Map<string, string>}
 */
export function parseStructTag(tag) {
	const map = new Map();
	if (!tag || typeof tag !== "string") return map;

	let str = tag;
	while (str.length > 0) {
		// Skip leading spaces
		let i = 0;
		while (i < str.length && str.charCodeAt(i) === 32) i++;
		str = str.slice(i);
		if (str.length === 0) break;

		// Scan to colon: key must not contain space, quote, colon, or control characters
		i = 0;
		while (
			i < str.length &&
			str.charCodeAt(i) > 32 &&
			str[i] !== ":" &&
			str[i] !== '"' &&
			str.charCodeAt(i) !== 127
		) {
			i++;
		}
		if (
			i === 0 ||
			i + 1 >= str.length ||
			str[i] !== ":" ||
			str[i + 1] !== '"'
		) {
			break;
		}
		const key = str.slice(0, i);
		str = str.slice(i + 1); // skip colon, now points to opening '"'

		// Scan quoted string to find closing '"'
		i = 1;
		while (i < str.length && str[i] !== '"') {
			if (str[i] === "\\") i++; // skip escaped char
			i++;
		}
		if (i >= str.length) break;

		const qval = str.slice(0, i + 1);
		str = str.slice(i + 1);

		if (!map.has(key)) {
			map.set(key, unquoteTagValue(qval));
		}
	}
	return map;
}

/**
 * Parses the "json" key from a struct tag string or parsed Map according to encoding/json rules.
 *
 * @param {string | Map<string, string> | null | undefined} tag
 * @returns {{ name: string | null, omitempty: boolean, ignored: boolean, options: string[] }}
 */
export function parseJsonTag(tag) {
	if (!tag) {
		return { name: null, omitempty: false, ignored: false, options: [] };
	}
	const map = typeof tag === "string" ? parseStructTag(tag) : tag;
	if (!map.has("json")) {
		return { name: null, omitempty: false, ignored: false, options: [] };
	}
	const raw = map.get("json");
	const parts = raw.split(",");
	const rawName = parts[0];
	const options = parts.slice(1);
	const omitempty = options.includes("omitempty");

	if (rawName === "-" && parts.length === 1) {
		return { name: "-", omitempty: false, ignored: true, options };
	}

	const name = rawName === "" ? null : rawName;
	return {
		name,
		omitempty,
		ignored: false,
		options,
	};
}
