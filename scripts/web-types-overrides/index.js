// What `scripts/gen-web-types.js` needs besides the WebIDL: which spec goes
// into which declaration package, the per-name exceptions to that, and the
// renames. Edit this, not the generated files under `stdlib/gofront/`.

// Package name -> its definition.
//   specs    @webref/idl spec names; a type defined in one of them belongs to
//            the package (members added to it by other specs come along).
//   names    types that belong to the package whatever spec defines them.
//   prefix   an IDL name prefix the package drops (`GPUDevice` -> `Device`).
//   renames  exact IDL name -> declared name, ahead of `prefix`.
export const PACKAGES = {
	dom: {
		specs: [
			"dom",
			"html",
			"uievents",
			"pointerevents",
			"geometry",
			"hr-time",
			"cssom",
			"cssom-view",
			"console",
			"storage",
			"url",
			"FileAPI",
			"encoding",
			"webcrypto",
			"IndexedDB",
		],
		names: [],
	},
	canvas: {
		specs: [],
		names: [
			"CanvasGradient",
			"CanvasPattern",
			"CanvasRenderingContext2D",
			"CanvasRenderingContext2DSettings",
			"ImageData",
			"ImageDataSettings",
			"OffscreenCanvasRenderingContext2D",
			"Path2D",
			"TextMetrics",
		],
	},
	fetch: {
		specs: ["fetch"],
		names: ["FormData"],
	},
	websocket: {
		specs: ["websockets"],
		names: [],
	},
	webgpu: {
		specs: ["webgpu"],
		names: [],
		prefix: "GPU",
	},
};

// IDL type names the specs use without defining one, and the type each stands
// for: `WindowProxy` is the `Window` object a window or frame exposes.
export const ALIASES = {
	WindowProxy: "Window",
};

// The packages whose generated file is committed under `stdlib/gofront/`.
// `npm run check` verifies these are current; the others are generated in
// memory only, so a mapping that stops working is noticed.
export const PUBLISHED = ["dom"];
