// src/lower/embedding.js
// Computes promoted methods and delegation stubs for embedded structs.

import {
	ambiguousPromotions,
	embeddedFieldName,
} from "../typechecker/types.js";

// A method promoted from an embedded struct value but declared on its
// pointer receiver is outside the method set of the outer struct's value.
function isPtrOnlyPromotion(rawEmbed, embed, mName, mType) {
	if (rawEmbed.kind === "pointer") return false;
	return Boolean((mType ?? embed.methods?.get(mName))?._ptrRecv);
}

// A pointer-receiver method reached through an embedded pointer, which may
// be nil.
function isNilablePtrRecv(rawEmbed, mType) {
	return rawEmbed.kind === "pointer" && Boolean(mType?._ptrRecv);
}

export function computeEmbeddedStubs(name, methodDecls, checker) {
	if (!checker) return [];
	const resolvedType = checker.types.get(name)?.underlying;
	if (resolvedType?.kind !== "struct" || !resolvedType._embeds) return [];

	// A method two embeds declare at the same depth is in neither method set:
	// no stub, so the value does not satisfy an interface that needs it.
	const declared = new Set([
		...methodDecls.map((m) => m.name),
		...ambiguousPromotions(resolvedType),
	]);
	const stubs = [];

	const embedded = (resolvedType._structFields ?? []).filter((f) => f.embedded);
	for (const [i, rawEmbed] of resolvedType._embeds.entries()) {
		const fieldName = embedded[i] ? embeddedFieldName(embedded[i]) : null;
		const embed = rawEmbed.kind === "pointer" ? rawEmbed.base : rawEmbed;
		const embedName = embed.kind === "named" ? embed.name : null;
		if (!embedName) continue;
		const embedBase = embed.kind === "named" ? embed.underlying : embed;
		if (embedBase?.kind !== "struct" || !embedBase.methods) {
			// A named non-struct type (`time.Duration`) promotes its value
			// methods; the stub passes the embedded value as the receiver.
			if (rawEmbed.kind === "pointer" || embedBase?.kind === "interface")
				continue;
			for (const [mName, mType] of embed.methods?.entries() ?? []) {
				if (declared.has(mName) || mType?._ptrRecv) continue;
				stubs.push({
					methodName: mName,
					embedName,
					fieldName,
					valueEmbed: true,
				});
				declared.add(mName);
			}
			continue;
		}

		for (const [mName, mType] of embedBase.methods.entries()) {
			if (!declared.has(mName)) {
				stubs.push({
					methodName: mName,
					embedName,
					fieldName,
					ptrOnly: isPtrOnlyPromotion(rawEmbed, embed, mName, mType),
					nilPtrRecv: isNilablePtrRecv(rawEmbed, mType),
				});
				declared.add(mName); // Prevent duplicate stubs for diamond embeds
			}
		}
	}

	return stubs;
}
