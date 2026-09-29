import { expect, test } from "@playwright/test";

test.describe("WebGL2 Rotating 3D Cube Showcase", () => {
	test("canvas renders and runs continuous animation loop without errors", async ({
		page,
	}) => {
		const errors = [];
		page.on("pageerror", (err) => errors.push(err.message));
		page.on("console", (msg) => {
			if (msg.type() === "error") errors.push(msg.text());
		});

		await page.goto("/");

		const canvas = page.locator("#glcanvas");
		await expect(canvas).toBeVisible();

		// Verify canvas dimensions
		const width = await canvas.evaluate((el) => el.width);
		const height = await canvas.evaluate((el) => el.height);
		expect(width).toBe(600);
		expect(height).toBe(600);

		// Wait for several animation frames
		await page.waitForTimeout(1000);

		// Verify no page errors or WebGL errors were thrown
		expect(errors).toEqual([]);
	});
});
