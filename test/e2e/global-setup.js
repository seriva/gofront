import { execSync } from "node:child_process";

export default function () {
	execSync(
		"npm run build:simple && npm run build:reactive && npm run build:gom && npm run build:templ",
		{
			stdio: "inherit",
		},
	);
}
