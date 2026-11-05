import { execSync } from "node:child_process";

export default function () {
	execSync("npm run build", {
		stdio: "inherit",
	});
	try {
		execSync("npx playwright install chromium", {
			stdio: "inherit",
		});
	} catch {
		// Ignore if offline and browser is already present
	}
}
