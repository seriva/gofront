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
			use: { baseURL: "http://127.0.0.2:3001" },
			testMatch: ["**/shared.spec.js", "**/simple.spec.js"],
		},
		{
			name: "reactive",
			use: { baseURL: "http://127.0.0.2:3002" },
			testMatch: ["**/shared.spec.js", "**/reactive.spec.js"],
		},
		{
			name: "gom",
			use: { baseURL: "http://127.0.0.2:3003" },
			testMatch: ["**/shared.spec.js", "**/gom.spec.js"],
		},
		{
			name: "templ",
			use: { baseURL: "http://127.0.0.2:3004" },
			testMatch: ["**/shared.spec.js", "**/templ.spec.js"],
		},
	],
	webServer: [
		{
			command: "npx serve example/simple -l 3001 -n",
			url: "http://127.0.0.2:3001",
			reuseExistingServer: !process.env.CI,
		},
		{
			command: "npx serve example/reactive -l 3002 -n",
			url: "http://127.0.0.2:3002",
			reuseExistingServer: !process.env.CI,
		},
		{
			command: "npx serve example/gom -l 3003 -n",
			url: "http://127.0.0.2:3003",
			reuseExistingServer: !process.env.CI,
		},
		{
			command: "npx serve example/templ -l 3004 -n",
			url: "http://127.0.0.2:3004",
			reuseExistingServer: !process.env.CI,
		},
	],
});
