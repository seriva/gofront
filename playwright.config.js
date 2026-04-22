import { defineConfig } from "@playwright/test";

export default defineConfig({
	testDir: "./test/e2e",
	globalSetup: "./test/e2e/global-setup.js",
	use: {
		headless: true,
		screenshot: "only-on-failure",
		trace: "retain-on-failure",
	},
	projects: [
		{
			name: "simple",
			use: { baseURL: "http://localhost:3001" },
			testMatch: ["**/shared.spec.js", "**/simple.spec.js"],
		},
		{
			name: "reactive",
			use: { baseURL: "http://localhost:3002" },
			testMatch: ["**/shared.spec.js", "**/reactive.spec.js"],
		},
		{
			name: "gom",
			use: { baseURL: "http://localhost:3003" },
			testMatch: ["**/shared.spec.js", "**/gom.spec.js"],
		},
	],
	webServer: [
		{
			command: "npx serve example/simple -l 3001",
			url: "http://localhost:3001",
			reuseExistingServer: !process.env.CI,
		},
		{
			command: "npx serve example/reactive -l 3002",
			url: "http://localhost:3002",
			reuseExistingServer: !process.env.CI,
		},
		{
			command: "npx serve example/gom -l 3003",
			url: "http://localhost:3003",
			reuseExistingServer: !process.env.CI,
		},
	],
});
