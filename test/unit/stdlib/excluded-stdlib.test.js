// GoFront test suite — stdlib members retired from the compiler

import { assertErrorContains, compile, section, test } from "../helpers.js";

section("Excluded stdlib members");

const EXCLUDED = [
	["encoding/binary", "binary", "Read", "binary.LittleEndian"],
	["encoding/binary", "binary", "Write", "binary.LittleEndian"],
	["encoding/binary", "binary", "Size", "binary.LittleEndian"],
	["fmt", "fmt", "Sscan", "strconv"],
	["fmt", "fmt", "Sscanln", "strconv"],
	["fmt", "fmt", "Sscanf", "strconv"],
];

for (const [path, pkg, member, hint] of EXCLUDED) {
	for (const target of ["js", "wasm"]) {
		test(`${pkg}.${member} reports the excluded-stdlib diagnostic in a ${target} package`, () => {
			const { errors } = compile(
				`//gofront:target ${target}\npackage main\nimport "${path}"\nvar _ = ${pkg}.${member}\nfunc main() {}\n`,
				{ target },
			);
			assertErrorContains(errors, `${pkg}.${member} is not available`);
			assertErrorContains(errors, hint);
		});
	}
}
