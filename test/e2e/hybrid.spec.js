import { expect, test } from "@playwright/test";

// example/hybrid — a `//gofront:target wasm` particle simulation whose
// `gofront/shared` buffers are rendered to a canvas from the JS side.

test.describe("Hybrid JS + WasmGC particle example", () => {
	test("loads app.wasm, renders particles and reacts to controls", async ({
		page,
	}) => {
		const errors = [];
		page.on("pageerror", (err) => errors.push(err.message));
		page.on("console", (msg) => {
			if (msg.type() === "error") errors.push(msg.text());
		});

		await page.goto("/");

		const canvas = page.locator("#sim");
		await expect(canvas).toBeVisible();
		await expect(page.locator("#live-count")).toHaveText("2048");

		// The simulation runs a few frames and paints onto the canvas.
		await page.waitForTimeout(600);
		const painted = await canvas.evaluate((el) => {
			const data = el
				.getContext("2d")
				.getImageData(0, 0, el.width, el.height).data;
			let lit = 0;
			for (let i = 0; i < data.length; i += 4) {
				if (data[i + 2] > 150) lit++; // particle blue channel
			}
			return lit;
		});
		expect(painted).toBeGreaterThan(100);

		// Changing the particle count re-seeds the wasm buffers.
		await page.locator('[data-action="count"][data-count="512"]').click();
		await expect(page.locator("#live-count")).toHaveText("512");
		await expect(
			page.locator('[data-action="count"][data-count="512"]'),
		).toHaveClass(/active/);

		await page.locator('[data-action="pause"]').click();
		await expect(page.locator('[data-action="pause"]')).toHaveText("Resume");

		expect(errors).toEqual([]);
	});
});
