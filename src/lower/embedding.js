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

// An embedded interface (named, literal or `error`) forwards each method of
// its method set to the interface value in the field.
function pushInterfaceStubs(stubs, declared, iface, fieldName) {
	for (const mName of iface.methods?.keys() ?? []) {
		if (declared.has(mName)) continue;
		stubs.push({ methodName: mName, fieldName, ifaceEmbed: true });
		declared.add(mName);
	}
}

function pushValueEmbedStubs(
	stubs,
	declared,
	rawEmbed,
	embed,
	embedName,
	fieldName,
) {
	const viaPtr = rawEmbed.kind === "pointer";
	for (const [mName, mType] of embed.methods?.entries() ?? []) {
		if (declared.has(mName)) continue;
		stubs.push({
			methodName: mName,
			embedName,
			fieldName,
			valueEmbed: true,
			ptrRecv: Boolean(mType?._ptrRecv),
			viaPtr,
			ptrOnly: isPtrOnlyPromotion(rawEmbed, embed, mName, mType),
			nilPtrRecv: isNilablePtrRecv(rawEmbed, mType),
		});
		declared.add(mName);
	}
}

export function computeEmbeddedStubs(name, methodDecls, checker) {
	if (!checker) return [];
	const resolvedType = checker.types.get(name)?.underlying;
	if (resolvedType?.kind !== "struct" || !resolvedType._embeds) return [];

	// A method two embeds declare at the same depth is in neither method set:
	// no stub, so the value does not satisfy an interface that needs it.
	// The type's own methods come from the checker as well: a method the
	// backend left out must still shadow what an embedded type promotes.
	const declared = new Set([
		...methodDecls.map((m) => m.name),
		...(checker.types.get(name)?.methods?.keys() ?? []),
		...ambiguousPromotions(resolvedType),
	]);
	const stubs = [];

	const embedded = (resolvedType._structFields ?? []).filter((f) => f.embedded);
	for (const [i, rawEmbed] of resolvedType._embeds.entries()) {
		const fieldName = embedded[i] ? embeddedFieldName(embedded[i]) : null;
		const embed = rawEmbed.kind === "pointer" ? rawEmbed.base : rawEmbed;
		const embedBase = embed.kind === "named" ? embed.underlying : embed;
		if (embedBase?.kind === "interface") {
			if (rawEmbed.kind !== "pointer" && fieldName)
				pushInterfaceStubs(stubs, declared, embedBase, fieldName);
			continue;
		}
		const embedName = embed.kind === "named" ? embed.name : null;
		if (!embedName) continue;
		if (embedBase?.kind !== "struct" || !embedBase.methods) {
			// A named non-struct type (`time.Duration`, `Num`, `*Num`) promotes
			// its methods; the stub passes the embedded value, box, or pointer.
			pushValueEmbedStubs(
				stubs,
				declared,
				rawEmbed,
				embed,
				embedName,
				fieldName,
			);
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
