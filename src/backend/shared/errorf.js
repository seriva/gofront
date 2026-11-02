// The operands that a constant `fmt.Errorf` format wraps with `%w`, in order.
// `*` width and precision consume an operand; an explicit argument index
// (`%[2]w`) is not followed (the call wraps nothing).  A format that is not a
// string literal wraps nothing.

export function wrappedErrorfArgs(fmtStr, callArgs) {
	const operands = callArgs.slice(1);
	return wrappedErrorfIndices(fmtStr)
		.map((i) => operands[i])
		.filter(Boolean);
}

// Index after a `*` (which takes an operand) or a run of digits at `i`.
function skipCount(s, i, onStar) {
	if (s[i] === "*") {
		onStar();
		return i + 1;
	}
	while (i < s.length && s[i] >= "0" && s[i] <= "9") i++;
	return i;
}

// Indexes (among the operands after the format) consumed by `%w` verbs.
export function wrappedErrorfIndices(fmtStr) {
	if (fmtStr?.kind !== "BasicLit" || typeof fmtStr.value !== "string")
		return [];
	const s = fmtStr.value;
	const wrapped = [];
	let next = 0;
	const star = () => next++;
	for (let i = 0; i < s.length; i++) {
		if (s[i] !== "%") continue;
		i++;
		while (i < s.length && "+-# 0".includes(s[i])) i++;
		if (s[i] === "[") return [];
		i = skipCount(s, i, star);
		if (s[i] === ".") i = skipCount(s, i + 1, star);
		if (i >= s.length || s[i] === "%") continue;
		if (s[i] === "w") wrapped.push(next);
		next++;
	}
	return wrapped;
}
