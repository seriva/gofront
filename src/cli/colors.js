// ANSI color helpers for CLI output. Honours NO_COLOR / FORCE_COLOR and
// otherwise only colors when the target stream is a TTY.

export function colorEnabled(stream = process.stderr) {
	if ("NO_COLOR" in process.env) return false;
	const force = process.env.FORCE_COLOR;
	if (force !== undefined) return force !== "0" && force !== "false";
	return Boolean(stream?.isTTY);
}

const CODES = {
	red: 31,
	green: 32,
	yellow: 33,
	blue: 34,
	magenta: 35,
	cyan: 36,
	gray: 90,
	bold: 1,
	dim: 2,
};

export function createColors(enabled) {
	const c = {};
	for (const [name, code] of Object.entries(CODES)) {
		c[name] = enabled ? (s) => `\x1b[${code}m${s}\x1b[0m` : (s) => `${s}`;
	}
	c.enabled = enabled;
	return c;
}

export const colors = createColors(colorEnabled(process.stderr));

const DIAG_LABEL = /^(Lex error|Parse error|Type error)(\b.*?)(:\s)/;
const GUTTER = /^(\s*\d+ \| )(.*)$/;
const CARET = /^(\s*)(\^+)$/;

// Colorizes a compiler diagnostic: red label, dimmed source gutter, red caret.
export function formatDiagnostic(message, c = colors) {
	if (!c.enabled) return message;
	return message
		.split("\n")
		.map((line) => {
			const label = line.match(DIAG_LABEL);
			if (label) {
				return `${c.bold(c.red(label[1]))}${c.dim(label[2])}${label[3]}${line.slice(label[0].length)}`;
			}
			const gutter = line.match(GUTTER);
			if (gutter) return `${c.dim(gutter[1])}${gutter[2]}`;
			const caret = line.match(CARET);
			if (caret) return `${caret[1]}${c.bold(c.red(caret[2]))}`;
			if (/^warning:/i.test(line.trim())) return c.yellow(line);
			return line;
		})
		.join("\n");
}

// Standard CLI log helpers writing to stderr with a colored `gofront:` prefix.
const prefix = () => colors.bold("gofront:");
const isDiagnostic = (msg) => DIAG_LABEL.test(msg) || msg.includes("\n");

export const log = {
	info: (msg) => console.error(`${prefix()} ${msg}`),
	ok: (msg) =>
		console.error(`${prefix()} ${colors.green("OK")}${msg ? ` ${msg}` : ""}`),
	warn: (msg) =>
		console.error(`${prefix()} ${colors.yellow(`warning: ${msg}`)}`),
	error: (msg) => {
		console.error(`${prefix()} ${colors.bold(colors.red("ERROR"))}`);
		for (const line of formatDiagnostic(msg).split("\n"))
			console.error(`  ${line}`);
	},
	// Compiler diagnostics get the block form; anything else is one red line.
	fail: (msg) =>
		isDiagnostic(msg)
			? log.error(msg)
			: console.error(`${prefix()} ${colors.red(msg)}`),
};

export const stamp = () => colors.dim(`[${new Date().toLocaleTimeString()}]`);
export const ms = (n) => colors.dim(`(${n}ms)`);
