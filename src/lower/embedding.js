// src/lower/embedding.js
// Computes promoted methods and delegation stubs for embedded structs.

export function computeEmbeddedStubs(name, methodDecls, checker) {
	if (!checker) return [];
	const resolvedType = checker.types.get(name)?.underlying;
	if (resolvedType?.kind !== "struct" || !resolvedType._embeds) return [];

	const declared = new Set(methodDecls.map((m) => m.name));
	const stubs = [];

	for (const embed of resolvedType._embeds) {
		const embedName = embed.kind === "named" ? embed.name : null;
		if (!embedName) continue;
		const embedBase = embed.kind === "named" ? embed.underlying : embed;
		if (embedBase?.kind !== "struct" || !embedBase.methods) continue;

		for (const [mName] of embedBase.methods.entries()) {
			if (!declared.has(mName)) {
				stubs.push({
					methodName: mName,
					embedName,
				});
				declared.add(mName); // Prevent duplicate stubs for diamond embeds
			}
		}
	}

	return stubs;
}
