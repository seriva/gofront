// test/unit/wasm/complex.test.js
// Tests for complex numbers in WASM: representation, arithmetic, builtins, literals, conversions.

import { assertEqual, compileHybrid, section, test } from "../helpers.js";

section("WASM Complex — Task 0.4a: Representation and Arithmetic");

test("complex zero values", () => {
	const src = `
package main

func Main() int {
	var z128 complex128
	var z64 complex64
	if real(z128) == 0 && imag(z128) == 0 && real(z64) == 0 && imag(z64) == 0 {
		return 1
	}
	return 0
}
`;
	const hybrid = compileHybrid(src);
	const res = hybrid.run("Main");
	assertEqual(res.wasmRes, 1n);
	assertEqual(res.jsRes, 1);
});

test("complex, real, and imag builtins", () => {
	const src = `
package main

func Main() int {
	z := complex(3.5, 4.5)
	if real(z) == 3.5 && imag(z) == 4.5 {
		return 1
	}
	return 0
}
`;
	const hybrid = compileHybrid(src);
	const res = hybrid.run("Main");
	assertEqual(res.wasmRes, 1n);
	assertEqual(res.jsRes, 1);
});

test("complex literals (3i, 1 + 2i)", () => {
	const src = `
package main

func Main() int {
	c1 := 3i
	c2 := 1.5 + 2.5i
	if real(c1) == 0 && imag(c1) == 3 && real(c2) == 1.5 && imag(c2) == 2.5 {
		return 1
	}
	return 0
}
`;
	const hybrid = compileHybrid(src);
	const res = hybrid.run("Main");
	assertEqual(res.wasmRes, 1n);
	assertEqual(res.jsRes, 1);
});

test("complex addition and subtraction", () => {
	const src = `
package main

func Main() int {
	a := complex(1.0, 2.0)
	b := complex(3.0, 4.0)
	sum := a + b
	diff := b - a
	if real(sum) == 4.0 && imag(sum) == 6.0 && real(diff) == 2.0 && imag(diff) == 2.0 {
		return 1
	}
	return 0
}
`;
	const hybrid = compileHybrid(src);
	const res = hybrid.run("Main");
	assertEqual(res.wasmRes, 1n);
	assertEqual(res.jsRes, 1);
});

test("complex multiplication", () => {
	const src = `
package main

func Main() int {
	// (1 + 2i) * (3 + 4i) = (1*3 - 2*4) + (1*4 + 2*3)i = -5 + 10i
	a := complex(1.0, 2.0)
	b := complex(3.0, 4.0)
	prod := a * b
	if real(prod) == -5.0 && imag(prod) == 10.0 {
		return 1
	}
	return 0
}
`;
	const hybrid = compileHybrid(src);
	const res = hybrid.run("Main");
	assertEqual(res.wasmRes, 1n);
	assertEqual(res.jsRes, 1);
});

test("complex division", () => {
	const src = `
package main

func Main() int {
	// (10 + 0i) / (2 + 0i) = 5 + 0i
	// (a*c + b*d)/(c*c + d*d), (b*c - a*d)/(c*c + d*d)
	// (3 + 4i) / (1 + 2i):
	// d = 1*1 + 2*2 = 5
	// re = (3*1 + 4*2)/5 = 11/5 = 2.2
	// im = (4*1 - 3*2)/5 = -2/5 = -0.4
	a := complex(3.0, 4.0)
	b := complex(1.0, 2.0)
	q := a / b
	if real(q) == 2.2 && imag(q) == -0.4 {
		return 1
	}
	return 0
}
`;
	const hybrid = compileHybrid(src);
	const res = hybrid.run("Main");
	assertEqual(res.wasmRes, 1n);
	assertEqual(res.jsRes, 1);
});

test("unary minus on complex", () => {
	const src = `
package main

func Main() int {
	a := complex(3.0, -4.5)
	b := -a
	if real(b) == -3.0 && imag(b) == 4.5 {
		return 1
	}
	return 0
}
`;
	const hybrid = compileHybrid(src);
	const res = hybrid.run("Main");
	assertEqual(res.wasmRes, 1n);
	assertEqual(res.jsRes, 1);
});

test("conversions between complex64 and complex128", () => {
	const src = `
package main

func Main() int {
	var c64 complex64 = complex(float32(1.5), float32(2.5))
	c128 := complex128(c64)
	c64back := complex64(c128)
	if real(c128) == 1.5 && imag(c128) == 2.5 && real(c64back) == 1.5 && imag(c64back) == 2.5 {
		return 1
	}
	return 0
}
`;
	const hybrid = compileHybrid(src);
	const res = hybrid.run("Main");
	assertEqual(res.wasmRes, 1n);
	assertEqual(res.jsRes, 1);
});

test("conversion from numeric scalar to complex", () => {
	const src = `
package main

func Main() int {
	x := 5
	c := complex128(x)
	var c64 complex64 = 7
	if real(c) == 5.0 && imag(c) == 0.0 && real(c64) == 7.0 && imag(c64) == 0.0 {
		return 1
	}
	return 0
}
`;
	const hybrid = compileHybrid(src);
	const res = hybrid.run("Main");
	assertEqual(res.wasmRes, 1n);
	assertEqual(res.jsRes, 1);
});

test("complex64 precision and rounding", () => {
	const src = `
package main

func Main() int {
	// 16777217 (2^24 + 1) cannot be represented exactly in float32 (rounds to 16777216)
	var c64 complex64 = complex(float32(16777217.0), float32(1.0))
	c128 := complex(16777217.0, 1.0)
	if real(c64) == 16777216.0 && real(c128) == 16777217.0 {
		return 1
	}
	return 0
}
`;
	const hybrid = compileHybrid(src);
	const res = hybrid.run("Main");
	assertEqual(res.wasmRes, 1n);
	assertEqual(res.jsRes, 1);
});

test("division by 0+0i yields Inf/NaN without panicking", () => {
	const src = `
package main

func Main() int {
	a := complex(1.0, 2.0)
	zero := complex(0.0, 0.0)
	q := a / zero
	// real and imag parts are Inf / NaN; should evaluate without panic
	r := real(q)
	i := imag(q)
	// r is not zero and either Inf or NaN; checking r != 0
	if r != 0 || i != 0 {
		return 1
	}
	return 0
}
`;
	const hybrid = compileHybrid(src);
	const res = hybrid.run("Main");
	assertEqual(res.wasmRes, 1n);
	assertEqual(res.jsRes, 1);
});

test("compound assignment on complex variable", () => {
	const src = `
package main

func Main() int {
	z := complex(1.0, 2.0)
	z += complex(3.0, 4.0) // 4 + 6i
	z -= complex(1.0, 1.0) // 3 + 5i
	z *= complex(2.0, 0.0) // 6 + 10i
	z /= complex(2.0, 0.0) // 3 + 5i
	if real(z) == 3.0 && imag(z) == 5.0 {
		return 1
	}
	return 0
}
`;
	const hybrid = compileHybrid(src);
	const res = hybrid.run("Main");
	assertEqual(res.wasmRes, 1n);
	assertEqual(res.jsRes, 1);
});
